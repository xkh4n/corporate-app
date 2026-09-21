import { randomUUID } from "node:crypto";
import { redis } from "../../databases/redis/connection";
import {
  IMPORT_JOB_PARTS,
  IMPORT_META_SCAN_PATTERN,
  importActiveJobKey,
  importDraftKey,
  importIdentityMissKey,
  importJobKey,
  isImportJobId,
} from "../../models/redis/assetImport.model";
import { assertImportRowStillValid, createAssetForImportRow, resolveImportRows } from "../postgres/assetImport.service";
import { getUserById } from "../mssql/user.service";
import { roleGrantsPermission } from "../postgres/permission.service";
import { validateImportCsv, toCsvLine } from "../../library/csvImport";
import type { ImportIssue } from "../../library/csvImport";
import { AppError, BadRequestError, ConflictError, NotFoundError } from "../../library/errors";
import { logger } from "../../library/logger";
import { env } from "../../library/env";
import type {
  ImportActor,
  ImportJobMeta,
  ImportJobStatus,
  ImportRowResult,
  ImportValidationReport,
  ResolvedImportRow,
} from "../../types/postgres/assetImport.types";

// Estado y reanudacion de la carga masiva de activos (plan 005). Redis guarda el trabajo (filas ya resueltas,
// cursor, resultado por fila) y un worker dentro de la API lo procesa de a una fila, cada una en su transaccion
// Postgres (services/postgres/assetImport.service.ts). Redis NO es la fuente de verdad de lo creado: solo recuerda
// donde ibamos. Va por detras de Postgres (AOF con fsync por segundo, replica asincrona), asi que al reanudar una
// fila ya confirmada se ADOPTA (ver createAssetForImportRow) y, si Redis pierde el trabajo entero, re-subir el
// mismo CSV es seguro: las series ya cargadas se rechazan con su tag.

const VALIDATED_TTL_SECONDS = 60 * 60;
const FINISHED_TTL_SECONDS = 7 * 24 * 60 * 60;
const ACTIVE_SLOT_TTL_SECONDS = 6 * 60 * 60;
const LEASE_MS = 30_000;
const SWEEP_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 20;
const MAX_STORED_ISSUES = 2000;
const STATUS_ISSUES_LIMIT = 200;
const MAX_CONCURRENT_JOBS_PER_PROCESS = 2;
const SHUTDOWN_WAIT_MS = 8_000;
// Identidades (usuario/RUT) que no se resolvieron al validar, por usuario y hora. Un archivo legitimo casi no tiene
// (un usuario mal escrito); un enumerador que sondea RUT falla casi todas. Al agotarse, validar responde 429.
const IDENTITY_MISS_BUDGET = 300;
const IDENTITY_MISS_WINDOW_SECONDS = 60 * 60;
// Cada tantas filas el worker revalida que el dueno siga activo y con permiso, y descarta la cache de productos.
const RECHECK_EVERY_ROWS = 100;

// Compare-and-pexpire / compare-and-delete: solo el dueno del lease (o del cupo) lo renueva o lo suelta.
const RENEW_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
// Cambia el estado solo si el actual esta entre los permitidos (ARGV[4..]): dos requests simultaneas no inician dos
// veces el mismo trabajo, y un cancel gana sobre el fin normal.
const TRANSITION_SCRIPT = `
local current = redis.call('hget', KEYS[1], 'status')
for i = 4, #ARGV do
  if current == ARGV[i] then
    redis.call('hset', KEYS[1], 'status', ARGV[1], ARGV[2], ARGV[3])
    return 1
  end
end
return 0`;
// Inicio ATOMICO de una carga validada: solo si sigue VALIDATED, toma el cupo del usuario (uno en curso a la vez),
// quita el vencimiento de sus claves y pasa a RUNNING, todo en un paso. KEYS: meta, rows, issues, res, cupo.
// ARGV: jobId, ahora (ISO), skipInvalid ("1"/"0"), TTL del cupo (s). Devuelve 1 = iniciada, 0 = ya no estaba VALIDATED,
// -1 = el usuario ya tiene otra carga en curso. Si no inicia, no toca TTL ni cupo.
const START_SCRIPT = `
if redis.call('hget', KEYS[1], 'status') ~= 'VALIDATED' then return 0 end
local current = redis.call('get', KEYS[5])
if current and current ~= ARGV[1] then
  if redis.call('hget', 'imp:' .. current .. ':meta', 'status') == 'RUNNING' then return -1 end
end
redis.call('set', KEYS[5], ARGV[1], 'EX', ARGV[4])
for i = 1, 4 do redis.call('persist', KEYS[i]) end
redis.call('hset', KEYS[1], 'status', 'RUNNING', 'startedAt', ARGV[2], 'skipInvalid', ARGV[3])
return 1`;
// Registro del resultado de una fila CON FENCING: solo si el worker sigue siendo el dueno del lease. Un worker pausado
// (GC, stall) cuyo lease vencio no puede reescribir el cursor hacia atras ni duplicar los contadores. Si el trabajo ya
// no esta RUNNING (se cancelo mientras se creaba la fila), aplica el vencimiento de fin de vida a `res`, que puede haberse
// creado recien. KEYS: lease, res, meta. ARGV: workerId, indice, resultado JSON, campo contador (ok|failed), siguiente
// cursor, TTL de fin de vida (s). Devuelve 1 = registrado, 0 = lease perdido.
const WRITE_RESULT_SCRIPT = `
if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('hset', KEYS[2], ARGV[2], ARGV[3])
redis.call('hincrby', KEYS[3], ARGV[4], 1)
redis.call('hset', KEYS[3], 'cursor', ARGV[5], 'inflight', '-1')
if redis.call('hget', KEYS[3], 'status') ~= 'RUNNING' then redis.call('expire', KEYS[2], ARGV[6]) end
return 1`;

// ---------- Cabecera (meta) ----------

function metaToHash(meta: ImportJobMeta): Record<string, string> {
  return {
    status: meta.status,
    ownerUserId: String(meta.ownerUserId),
    filename: meta.filename,
    totalRows: String(meta.totalRows),
    validRows: String(meta.validRows),
    invalidRows: String(meta.invalidRows),
    cursor: String(meta.cursor),
    ok: String(meta.ok),
    failed: String(meta.failed),
    attempts: String(meta.attempts),
    inflight: String(meta.inflight),
    skipInvalid: meta.skipInvalid ? "1" : "0",
    createdAt: meta.createdAt,
    startedAt: meta.startedAt ?? "",
    finishedAt: meta.finishedAt ?? "",
  };
}

function hashToMeta(id: string, hash: Record<string, string>): ImportJobMeta | null {
  if (!hash.status) return null;
  return {
    id,
    status: hash.status as ImportJobStatus,
    ownerUserId: Number(hash.ownerUserId),
    filename: hash.filename ?? "",
    totalRows: Number(hash.totalRows),
    validRows: Number(hash.validRows),
    invalidRows: Number(hash.invalidRows),
    cursor: Number(hash.cursor),
    ok: Number(hash.ok),
    failed: Number(hash.failed),
    attempts: Number(hash.attempts),
    inflight: Number(hash.inflight),
    skipInvalid: hash.skipInvalid === "1",
    createdAt: hash.createdAt ?? "",
    startedAt: hash.startedAt || null,
    finishedAt: hash.finishedAt || null,
  };
}

async function getJobMeta(jobId: string): Promise<ImportJobMeta | null> {
  if (!isImportJobId(jobId)) return null;
  return hashToMeta(jobId, await redis.hGetAll(importJobKey(jobId, "meta")));
}

// 404 tanto si no existe como si es de otro usuario (dueno o admin la ven): un tercero no debe poder distinguir "existe
// pero no es mia" de "no existe" (el id queda escrito en las notas de los movimientos que crea la carga). Un id que no
// es UUID nunca llega a formar una clave.
async function loadJobForActor(jobId: string, actor: ImportActor): Promise<ImportJobMeta> {
  const meta = await getJobMeta(jobId);
  if (!meta || (!actor.isAdmin && meta.ownerUserId !== actor.userId)) {
    throw new NotFoundError("La carga no existe o ya expiró");
  }
  return meta;
}

async function transition(
  jobId: string,
  to: ImportJobStatus,
  timestampField: "startedAt" | "finishedAt",
  allowedFrom: ImportJobStatus[],
): Promise<boolean> {
  const changed = await redis.eval(TRANSITION_SCRIPT, {
    keys: [importJobKey(jobId, "meta")],
    arguments: [to, timestampField, new Date().toISOString(), ...allowedFrom],
  });
  return Number(changed) === 1;
}

async function setExpiry(jobId: string, seconds: number | null): Promise<void> {
  const pipeline = redis.multi();
  for (const part of IMPORT_JOB_PARTS) {
    const key = importJobKey(jobId, part);
    if (seconds === null) pipeline.persist(key);
    else pipeline.expire(key, seconds);
  }
  await pipeline.exec();
}

async function releaseActiveSlot(userId: number, jobId: string): Promise<void> {
  await redis.eval(RELEASE_SCRIPT, { keys: [importActiveJobKey(userId)], arguments: [jobId] });
}

// ---------- Validacion (paso 1) ----------

// Sin caracteres de control ni separadores de ruta y acotado: el nombre lo manda el cliente y termina en logs y respuestas.
function sanitizeFilename(name: string): string {
  return name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 100) || "carga.csv";
}

// Borra un borrador (VALIDATED) sin iniciar; si ya no lo es (se inicio o cancelo), no toca nada. KEYS: meta, rows, issues, res.
const DELETE_DRAFT_SCRIPT = `
if redis.call('hget', KEYS[1], 'status') == 'VALIDATED' then
  redis.call('del', KEYS[1], KEYS[2], KEYS[3], KEYS[4])
  return 1
end
return 0`;

// Un borrador por usuario: validar un archivo nuevo descarta el borrador anterior sin iniciar. Acota lo que un usuario
// puede dejar en Redis (cada borrador guarda ~1 MB) sin depender solo del vencimiento de 1 hora.
async function replaceDraft(userId: number, jobId: string): Promise<void> {
  const previousId = await redis.set(importDraftKey(userId), jobId, { EX: VALIDATED_TTL_SECONDS, GET: true });
  if (!previousId || previousId === jobId || !isImportJobId(previousId)) return;
  await redis.eval(DELETE_DRAFT_SCRIPT, {
    keys: IMPORT_JOB_PARTS.map((part) => importJobKey(previousId, part)),
    arguments: [],
  });
}

// Presupuesto de identidades no resueltas por usuario y hora (ver IDENTITY_MISS_BUDGET): validar un archivo con RUT o
// usuarios inexistentes es un oraculo sobre el directorio de colaboradores; un archivo real casi no falla en eso.
async function spendIdentityMissBudget(userId: number, misses: number): Promise<void> {
  if (misses === 0) return;
  const key = importIdentityMissKey(userId);
  const used = await redis.incrBy(key, misses);
  if (used === misses) await redis.expire(key, IDENTITY_MISS_WINDOW_SECONDS);
  if (used > IDENTITY_MISS_BUDGET) {
    logger.warn({ userId, used }, "Carga masiva de activos: demasiadas identidades inexistentes");
    throw new AppError(429, "Demasiados usuarios o RUT inexistentes en los archivos cargados; revise el archivo e intente más tarde");
  }
}

export async function validateAndCreateImportJob(
  actor: ImportActor,
  originalFilename: string,
  csvText: string,
): Promise<ImportValidationReport> {
  const syntactic = validateImportCsv(csvText);
  let resolved: Awaited<ReturnType<typeof resolveImportRows>>;
  try {
    resolved = await resolveImportRows(syntactic.rows);
  } catch (err) {
    if (err instanceof AppError) throw err;
    // El error de una consulta (Sequelize) trae el SQL con hasta 5.000 RUT/usuarios en linea: no debe llegar a los
    // logs ni a la respuesta. Se registra solo su clase y codigo.
    const code = (err as { parent?: { code?: string }; original?: { code?: string } }).parent?.code ??
      (err as { original?: { code?: string } }).original?.code;
    logger.error({ userId: actor.userId, errorName: err instanceof Error ? err.name : "unknown", code }, "Fallo la resolucion de las filas de la carga masiva");
    throw new AppError(500, "No se pudo validar el archivo en este momento; intente nuevamente");
  }
  await spendIdentityMissBudget(
    actor.userId,
    resolved.issues.filter((issue) => issue.column === "assigned_rut" || issue.column === "assigned_username").length,
  );
  const issues = [...syntactic.issues, ...resolved.issues].sort((a, b) => a.row - b.row);
  const invalidRows = new Set(issues.map((issue) => issue.row)).size;

  const jobId = randomUUID();
  const meta: ImportJobMeta = {
    id: jobId,
    status: "VALIDATED",
    ownerUserId: actor.userId,
    filename: sanitizeFilename(originalFilename),
    totalRows: syntactic.totalRows,
    validRows: resolved.rows.length,
    invalidRows,
    cursor: 0,
    ok: 0,
    failed: 0,
    attempts: 0,
    inflight: -1,
    skipInvalid: false,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };
  const pipeline = redis
    .multi()
    .hSet(importJobKey(jobId, "meta"), metaToHash(meta))
    .set(importJobKey(jobId, "rows"), JSON.stringify(resolved.rows))
    .set(importJobKey(jobId, "issues"), JSON.stringify(issues.slice(0, MAX_STORED_ISSUES)));
  for (const part of ["meta", "rows", "issues"] as const) pipeline.expire(importJobKey(jobId, part), VALIDATED_TTL_SECONDS);
  await pipeline.exec();
  await replaceDraft(actor.userId, jobId);

  logger.info(
    { userId: actor.userId, jobId, filename: meta.filename, totalRows: meta.totalRows, validRows: meta.validRows, invalidRows },
    "Carga masiva de activos validada",
  );
  return { jobId, totalRows: meta.totalRows, validRows: meta.validRows, invalidRows, issues: issues.slice(0, STATUS_ISSUES_LIMIT) };
}

// ---------- Inicio, reanudacion, cancelacion y consulta ----------

export async function startImportJob(jobId: string, actor: ImportActor, skipInvalid: boolean): Promise<ImportJobMeta> {
  const meta = await loadJobForActor(jobId, actor);
  if (meta.status !== "VALIDATED") {
    throw new ConflictError(`La carga está en estado ${meta.status}; solo se inicia una carga recién validada`);
  }
  if (meta.invalidRows > 0 && !skipInvalid) {
    throw new BadRequestError(
      `El archivo tiene ${meta.invalidRows} fila(s) con errores: corríjalo y vuelva a subirlo, o inicie con skipInvalid=true para cargar solo las válidas`,
      { invalidRows: meta.invalidRows },
    );
  }
  if (meta.validRows === 0) throw new BadRequestError("No hay filas válidas para cargar");

  // Un solo paso atomico: revalida VALIDATED, toma el cupo del dueno, quita el vencimiento y pasa a RUNNING.
  const started = Number(
    await redis.eval(START_SCRIPT, {
      keys: [...IMPORT_JOB_PARTS.map((part) => importJobKey(jobId, part)), importActiveJobKey(meta.ownerUserId)],
      arguments: [jobId, new Date().toISOString(), skipInvalid ? "1" : "0", String(ACTIVE_SLOT_TTL_SECONDS)],
    }),
  );
  if (started === -1) {
    throw new ConflictError("Ya tiene una carga en curso; espere a que termine o cancélela antes de iniciar otra");
  }
  if (started !== 1) throw new ConflictError("La carga ya fue iniciada o cancelada");
  // userId = quien inicio (puede ser un admin); ownerUserId = dueno y autor (`created_by`) de los activos.
  logger.info(
    { userId: actor.userId, ownerUserId: meta.ownerUserId, jobId, validRows: meta.validRows, skipInvalid },
    "Carga masiva de activos iniciada",
  );
  void runImportJob(jobId);
  return (await getJobMeta(jobId)) ?? meta;
}

// Reanuda a mano un trabajo RUNNING (p. ej. tras una caida, sin esperar al barrido). Si otro worker lo tiene, no hace nada.
export async function resumeImportJob(
  jobId: string,
  actor: ImportActor,
): Promise<{ meta: ImportJobMeta; alreadyProcessing: boolean; queued: boolean }> {
  const meta = await loadJobForActor(jobId, actor);
  if (meta.status !== "RUNNING") throw new ConflictError(`La carga está en estado ${meta.status}; solo se reanuda una carga en curso`);
  const alreadyProcessing = (await redis.exists(importJobKey(jobId, "lease"))) === 1;
  // Este proceso ya corre el maximo de cargas: no se toma ahora, el barrido de alguna replica la retomara en breve.
  const queued = !alreadyProcessing && (runningHere.size >= MAX_CONCURRENT_JOBS_PER_PROCESS || shuttingDown);
  if (!alreadyProcessing && !queued) void runImportJob(jobId);
  return { meta, alreadyProcessing, queued };
}

export async function cancelImportJob(jobId: string, actor: ImportActor): Promise<ImportJobMeta> {
  const meta = await loadJobForActor(jobId, actor);
  if (!(await transition(jobId, "CANCELLED", "finishedAt", ["VALIDATED", "RUNNING"]))) {
    throw new ConflictError(`La carga ya está en estado ${meta.status} y no se puede cancelar`);
  }
  await setExpiry(jobId, meta.status === "VALIDATED" ? VALIDATED_TTL_SECONDS : FINISHED_TTL_SECONDS);
  await releaseActiveSlot(meta.ownerUserId, jobId);
  logger.info({ userId: actor.userId, jobId, cursor: meta.cursor }, "Carga masiva de activos cancelada");
  return (await getJobMeta(jobId)) ?? meta;
}

export async function getImportJobStatus(
  jobId: string,
  actor: ImportActor,
): Promise<{ meta: ImportJobMeta; pending: number; issues: ImportIssue[]; issuesTotal: number }> {
  const meta = await loadJobForActor(jobId, actor);
  const issues = await readIssues(jobId);
  return {
    meta,
    pending: Math.max(0, meta.validRows - meta.cursor),
    issues: issues.slice(0, STATUS_ISSUES_LIMIT),
    issuesTotal: issues.length,
  };
}

async function readIssues(jobId: string): Promise<ImportIssue[]> {
  const raw = await redis.get(importJobKey(jobId, "issues"));
  return raw ? (JSON.parse(raw) as ImportIssue[]) : [];
}

async function readRows(jobId: string): Promise<ResolvedImportRow[]> {
  const raw = await redis.get(importJobKey(jobId, "rows"));
  return raw ? (JSON.parse(raw) as ResolvedImportRow[]) : [];
}

// CSV con el resultado de cada fila (ordenado por numero de fila del archivo): OK con el tag, ERROR con el motivo,
// INVALIDA (no pasó la validación), PENDIENTE (aun no procesada).
export async function buildImportJobResultCsv(jobId: string, actor: ImportActor): Promise<string> {
  await loadJobForActor(jobId, actor);
  const [rows, issues, results] = await Promise.all([
    readRows(jobId),
    readIssues(jobId),
    redis.hGetAll(importJobKey(jobId, "res")),
  ]);
  const lines: { row: number; line: string }[] = [];
  rows.forEach((row, index) => {
    const raw = results[String(index)];
    const result = raw ? (JSON.parse(raw) as ImportRowResult) : null;
    if (!result) lines.push({ row: row.row, line: toCsvLine([row.row, row.serialNumber, "PENDIENTE", "", ""]) });
    else if (result.ok) lines.push({ row: row.row, line: toCsvLine([row.row, row.serialNumber, "OK", result.tag, result.adopted ? "Confirmada en un intento anterior" : ""]) });
    else lines.push({ row: row.row, line: toCsvLine([row.row, row.serialNumber, "ERROR", "", result.error]) });
  });
  const issuesByRow = new Map<number, string[]>();
  for (const issue of issues) {
    issuesByRow.set(issue.row, [...(issuesByRow.get(issue.row) ?? []), `${issue.column}: ${issue.message}`]);
  }
  for (const [row, messages] of issuesByRow) {
    lines.push({ row, line: toCsvLine([row, "", "INVALIDA", "", messages.join(" | ")]) });
  }
  lines.sort((a, b) => a.row - b.row);
  return ["fila,serie,resultado,tag,detalle", ...lines.map((entry) => entry.line)].join("\r\n") + "\r\n";
}

// ---------- Worker ----------

const runningHere = new Set<string>();
let shuttingDown = false;
let sweeping = false;
let sweepTimer: NodeJS.Timeout | null = null;

async function acquireLease(jobId: string, workerId: string): Promise<boolean> {
  return (await redis.set(importJobKey(jobId, "lease"), workerId, { NX: true, PX: LEASE_MS })) === "OK";
}

async function renewLease(jobId: string, workerId: string): Promise<boolean> {
  const renewed = await redis.eval(RENEW_SCRIPT, { keys: [importJobKey(jobId, "lease")], arguments: [workerId, String(LEASE_MS)] });
  return Number(renewed) === 1;
}

async function releaseLease(jobId: string, workerId: string): Promise<void> {
  await redis.eval(RELEASE_SCRIPT, { keys: [importJobKey(jobId, "lease")], arguments: [workerId] });
}

// Errores de infraestructura (base caida, timeout, deadlock, conexion cortada): no son culpa de la fila, el trabajo
// se detiene y se reintenta. Cualquier otro error de una fila se registra como fallo de esa fila para que un dato
// que la base rechaza no envenene el trabajo entero.
const TRANSIENT_DB_CODES = new Set([
  "40P01", "40001", "57P01", "53300", "08006", "08001", "08004",
  "ECONNRESET", "ETIMEDOUT", "ETIMEOUT", "ECONNREFUSED", "ECONNCLOSED", "ESOCKET", "ELOGIN",
]);

function isTransientInfrastructureError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name.startsWith("SequelizeConnection") || err.name === "SequelizeTimeoutError") return true;
  // Mongo (la revalidacion del producto por fila): un corte de red no es culpa de la fila.
  if (err.name.startsWith("MongoNetwork") || err.name === "MongoServerSelectionError" || err.name === "MongoNotConnectedError") return true;
  const holder = err as { code?: string; parent?: { code?: string }; original?: { code?: string } };
  const code = holder.parent?.code ?? holder.original?.code ?? holder.code;
  return code !== undefined && TRANSIENT_DB_CODES.has(code);
}

// El dueno debe seguir activo y con el permiso: un usuario desactivado o al que se le quito el permiso mientras su carga
// corre no debe seguir creando activos hasta 1 hora despues de haber validado el archivo.
async function ownerMayStillImport(ownerUserId: number): Promise<boolean> {
  if (env.flags.disablePermissions) return true;
  try {
    const user = await getUserById(ownerUserId);
    if (!user || !user.isActive) return false;
    return await roleGrantsPermission(user.roleId, "asset-imports", "create");
  } catch (err) {
    if (err instanceof AppError) return false;
    throw err;
  }
}

async function cancelBecauseOwnerLostAccess(meta: ImportJobMeta): Promise<void> {
  if (!(await transition(meta.id, "CANCELLED", "finishedAt", ["RUNNING"]))) return;
  await setExpiry(meta.id, FINISHED_TTL_SECONDS);
  await releaseActiveSlot(meta.ownerUserId, meta.id);
  logger.warn({ ownerUserId: meta.ownerUserId, jobId: meta.id }, "Carga masiva de activos cancelada: el dueño ya no está activo o perdió el permiso");
}

async function processRow(
  row: ResolvedImportRow,
  context: Parameters<typeof createAssetForImportRow>[1],
  activeProducts: Map<string, boolean>,
): Promise<ImportRowResult> {
  try {
    // Los datos se resolvieron al validar (hasta 1 h antes): el usuario asignado y el producto se revalidan ahora.
    await assertImportRowStillValid(row, activeProducts);
    const { tag, adopted } = await createAssetForImportRow(row, context);
    return { ok: true, tag, adopted };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    if (isTransientInfrastructureError(err)) throw err;
    logger.error({ err, jobId: context.jobId, row: row.row }, "Error inesperado al crear un activo de la carga masiva");
    return { ok: false, error: "Error interno al crear el activo" };
  }
}

async function finishJob(meta: ImportJobMeta, status: "DONE" | "FAILED"): Promise<void> {
  if (!(await transition(meta.id, status, "finishedAt", ["RUNNING"]))) return; // se cancelo mientras terminaba
  await setExpiry(meta.id, FINISHED_TTL_SECONDS);
  await releaseActiveSlot(meta.ownerUserId, meta.id);
  const final = (await getJobMeta(meta.id)) ?? meta;
  logger.info(
    { userId: final.ownerUserId, jobId: final.id, status, total: final.validRows, ok: final.ok, failed: final.failed, attempts: final.attempts },
    "Carga masiva de activos terminada",
  );
}

async function processJob(jobId: string, workerId: string): Promise<void> {
  const meta = await getJobMeta(jobId);
  if (!meta || meta.status !== "RUNNING") return;

  const attempts = await redis.hIncrBy(importJobKey(jobId, "meta"), "attempts", 1);
  if (attempts > MAX_ATTEMPTS) {
    logger.error({ jobId, attempts }, "Carga masiva de activos abandonada tras demasiados intentos");
    await finishJob(meta, "FAILED");
    return;
  }
  const rows = await readRows(jobId);
  if (rows.length < meta.validRows) {
    // Las filas resueltas ya no estan en Redis (perdida de datos del nodo): no hay nada seguro que procesar.
    logger.error({ jobId, expected: meta.validRows, found: rows.length }, "Carga masiva de activos sin sus filas en Redis");
    await finishJob(meta, "FAILED");
    return;
  }
  const context = {
    jobId,
    actorUserId: meta.ownerUserId,
    jobStartedAt: new Date(meta.startedAt ?? meta.createdAt),
    // Desde el segundo intento una fila pudo confirmarse en Postgres sin quedar registrada en Redis.
    mayAdopt: attempts > 1,
  };
  if (attempts > 1) {
    logger.warn({ jobId, attempts, cursor: meta.cursor, inflight: meta.inflight }, "Carga masiva de activos reanudada");
  }

  const activeProducts = new Map<string, boolean>();
  for (let index = meta.cursor; index < rows.length; index++) {
    // Cierre ordenado: el trabajo queda RUNNING y sin lease, el barrido de otra replica lo retoma.
    if (shuttingDown) return;
    if ((await redis.hGet(importJobKey(jobId, "meta"), "status")) !== "RUNNING") return; // cancelado
    if (!(await renewLease(jobId, workerId))) return; // otro worker lo tomo
    if ((index - meta.cursor) % RECHECK_EVERY_ROWS === 0) {
      activeProducts.clear();
      if (!(await ownerMayStillImport(meta.ownerUserId))) {
        await cancelBecauseOwnerLostAccess(meta);
        return;
      }
    }
    await redis.hSet(importJobKey(jobId, "meta"), { inflight: String(index) });

    const outcome = await processRow(rows[index]!, context, activeProducts);

    // Escritura con fencing: solo si seguimos siendo el dueno del lease. Si se perdio mientras se creaba la fila, no
    // se escribe nada (ni el cursor ni los contadores): el worker que lo tomo la adoptara.
    const recorded = await redis.eval(WRITE_RESULT_SCRIPT, {
      keys: [importJobKey(jobId, "lease"), importJobKey(jobId, "res"), importJobKey(jobId, "meta")],
      arguments: [workerId, String(index), JSON.stringify(outcome), outcome.ok ? "ok" : "failed", String(index + 1), String(FINISHED_TTL_SECONDS)],
    });
    if (Number(recorded) !== 1) return;
  }
  await finishJob(meta, "DONE");
}

// Toma el lease y procesa el trabajo hasta terminarlo. Seguro de llamar varias veces: si otro worker (de esta u otra
// replica) lo tiene, no hace nada.
export async function runImportJob(jobId: string): Promise<void> {
  if (shuttingDown || runningHere.has(jobId) || runningHere.size >= MAX_CONCURRENT_JOBS_PER_PROCESS) return;
  runningHere.add(jobId);
  const workerId = randomUUID();
  try {
    if (!(await acquireLease(jobId, workerId))) return;
    try {
      await processJob(jobId, workerId);
    } finally {
      await releaseLease(jobId, workerId).catch(() => undefined);
    }
  } catch (err) {
    // Error de infraestructura: el trabajo sigue RUNNING y el barrido lo reintenta.
    logger.error({ err, jobId }, "La carga masiva de activos se detuvo por un error; se reintentará");
  } finally {
    runningHere.delete(jobId);
  }
}

// Recorre los trabajos RUNNING sin lease (el worker murio o la replica se reinicio) y los retoma.
export async function sweepStalledImportJobs(): Promise<void> {
  // Sin solapes: si un barrido anterior sigue (mucho keyspace, Redis lento), no se apila otro encima.
  if (shuttingDown || sweeping) return;
  sweeping = true;
  try {
    for await (const batch of redis.scanIterator({ MATCH: IMPORT_META_SCAN_PATTERN, COUNT: 100 })) {
      for (const key of Array.isArray(batch) ? batch : [batch]) {
        const jobId = key.split(":")[1] ?? "";
        if (!isImportJobId(jobId)) continue;
        if ((await redis.hGet(key, "status")) !== "RUNNING") continue;
        if ((await redis.exists(importJobKey(jobId, "lease"))) === 1) continue;
        void runImportJob(jobId);
      }
    }
  } catch (err) {
    logger.error({ err }, "Fallo el barrido de cargas masivas de activos");
  } finally {
    sweeping = false;
  }
}

export function startImportSweeper(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => void sweepStalledImportJobs(), SWEEP_INTERVAL_MS);
  sweepTimer.unref();
  // Al arrancar (p. ej. tras un reinicio de la replica) se revisa de inmediato, no a los 30 s.
  void sweepStalledImportJobs();
}

// Cierre ordenado (SIGTERM/SIGINT): deja de tomar trabajos y espera un tiempo acotado a que termine la fila en curso.
// Los trabajos quedan RUNNING y sin lease; otra replica los retoma.
export async function stopImportWorkers(): Promise<void> {
  shuttingDown = true;
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  const deadline = Date.now() + SHUTDOWN_WAIT_MS;
  while (runningHere.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
