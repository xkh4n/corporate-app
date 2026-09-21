import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PermissionModel } from "../../models/postgres/permission.model";
import { RoleModel } from "../../models/postgres/role.model";
import { RolePermissionModel } from "../../models/postgres/rolePermission.model";
import { resetTestData } from "../../../test/setupIntegration";
import { redis } from "../../databases/redis/connection";
import { AssetModel } from "../../models/postgres/asset.model";
import { importActiveJobKey, importJobKey } from "../../models/redis/assetImport.model";
import { AppError, BadRequestError, ConflictError, NotFoundError } from "../../library/errors";
import type { ImportActor, ImportRowResult, ResolvedImportRow } from "../../types/postgres/assetImport.types";
import { createPerson } from "../mssql/person.service";
import { createUser, deactivateUser } from "../mssql/user.service";
import { createProduct, deactivateProduct } from "../mongo/product.service";
import { createProductCategory } from "../mongo/productCategory.service";
import { getRoleByName, createRole } from "../postgres/role.service";
import { addRolePermission } from "../postgres/permission.service";
import { createCostCenter } from "../postgres/costCenter.service";
import { createAssetsFromReceipt } from "../postgres/asset.service";
import { createAssetForImportRow } from "../postgres/assetImport.service";
import {
  buildImportJobResultCsv,
  cancelImportJob,
  getImportJobStatus,
  resumeImportJob,
  runImportJob,
  startImportJob,
  sweepStalledImportJobs,
  validateAndCreateImportJob,
} from "./assetImportJob.service";

const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: ["asset_movement_users", "asset_movements", "asset_kardex_entries", "assets", "cost_centers"],
  mongo: ["Product", "ProductCategory"],
};

const HEADER = "serial_number,product,category,cost_center_code,status,assigned_username,assigned_rut,warranty_expires_at";
let seq = 0;
const createdRoleIds: number[] = [];

async function clearImportKeys(): Promise<void> {
  for await (const batch of redis.scanIterator({ MATCH: "imp:*", COUNT: 100 })) {
    const keys = Array.isArray(batch) ? batch : [batch];
    if (keys.length > 0) await redis.del(keys);
  }
}

beforeEach(async () => {
  await clearImportKeys();
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  await clearImportKeys();
  await resetTestData(RESET_TABLES);
  if (createdRoleIds.length > 0) {
    await RolePermissionModel.destroy({ where: { roleId: createdRoleIds } });
    await RoleModel.destroy({ where: { id: createdRoleIds } });
    createdRoleIds.length = 0;
  }
});

// Un actor NO admin recibe un rol propio con asset-imports:read y create (el worker revalida el permiso del dueno).
// `withPermission: false` crea uno sin permisos.
async function createActor(isAdmin = false, withPermission = true): Promise<ImportActor & { username: string }> {
  let roleId: number;
  if (isAdmin) {
    const role = await getRoleByName("admin");
    if (!role) throw new Error("Falta el rol admin sembrado");
    roleId = role.id;
  } else {
    const role = await createRole({ name: `job-test-${++seq}` });
    createdRoleIds.push(role.id);
    if (withPermission) {
      for (const permission of await PermissionModel.findAll({ where: { resource: "asset-imports" } })) {
        await addRolePermission(role.id, permission.id);
      }
    }
    roleId = role.id;
  }
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `Job${id}`,
    documentId: `TESTDOC-JOB${id}`,
    email: `test-job-${id}@example.com`,
  });
  const user = await createUser({ personId: person.id, roleId, username: `testjob${id}` });
  return { userId: user.id, isAdmin, username: user.username };
}

async function createCatalog() {
  const costCenter = await createCostCenter({ code: 71000 + ++seq, name: "Centro job" });
  const category = await createProductCategory({ name: `Categoria job ${++seq}` });
  const product = await createProduct({ name: `Producto job ${++seq}`, productType: "COMPRA", categoryId: String(category._id) });
  return { costCenter, product };
}

function csv(lines: string[]): string {
  return [HEADER, ...lines].join("\n");
}

// N filas validas AVAILABLE con series SN-JOB-<n>.
function validLines(count: number, product: string, costCenterCode: number, prefix = "SN-JOB"): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i + 1},${product},,${costCenterCode},,,,`);
}

async function waitForStatus(jobId: string, actor: ImportActor, status: string, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = await getImportJobStatus(jobId, actor);
    if (current.meta.status === status) return current;
    if (Date.now() > deadline) throw new Error(`La carga no llego a ${status}: ${JSON.stringify(current.meta)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function holdLease(jobId: string): Promise<void> {
  await redis.set(importJobKey(jobId, "lease"), "worker-ajeno", { PX: 120_000 });
}

async function readRows(jobId: string): Promise<ResolvedImportRow[]> {
  return JSON.parse((await redis.get(importJobKey(jobId, "rows")))!) as ResolvedImportRow[];
}

describe("validacion y flujo completo", () => {
  it("valida, inicia y crea todos los activos; el resultado lista cada tag y se libera el cupo", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();

    const report = await validateAndCreateImportJob(actor, "carga.csv", csv(validLines(5, product.name, costCenter.code)));
    expect(report).toMatchObject({ totalRows: 5, validRows: 5, invalidRows: 0, issues: [] });
    // Sin iniciar, el trabajo vence solo (no queda basura en Redis).
    expect(await redis.ttl(importJobKey(report.jobId, "meta"))).toBeGreaterThan(0);
    expect(await AssetModel.count()).toBe(0);

    const started = await startImportJob(report.jobId, actor, false);
    expect(started.status).toBe("RUNNING");
    const done = await waitForStatus(report.jobId, actor, "DONE");

    expect(done.meta).toMatchObject({ ok: 5, failed: 0, cursor: 5, inflight: -1, attempts: 1 });
    expect(done.pending).toBe(0);
    expect(await AssetModel.count()).toBe(5);
    expect(await redis.get(importActiveJobKey(actor.userId))).toBeNull();
    // Terminado, se conserva 7 dias para descargar el resultado.
    expect(await redis.ttl(importJobKey(report.jobId, "meta"))).toBeGreaterThan(24 * 3600);

    const result = await buildImportJobResultCsv(report.jobId, actor);
    const lines = result.trim().split("\r\n");
    expect(lines[0]).toBe("fila,serie,resultado,tag,detalle");
    expect(lines).toHaveLength(6);
    for (const line of lines.slice(1)) expect(line).toMatch(/^\d+,SN-JOB-\d,OK,ACT\d{9},$/);
  });

  it("un archivo con filas invalidas no se inicia salvo skipInvalid, que carga solo las validas", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const lines = [...validLines(2, product.name, costCenter.code), `SN-MALA,No existe,,${costCenter.code},,,,`];

    const report = await validateAndCreateImportJob(actor, "carga.csv", csv(lines));
    expect(report).toMatchObject({ totalRows: 3, validRows: 2, invalidRows: 1 });
    expect(report.issues).toEqual([expect.objectContaining({ row: 4, column: "product" })]);

    await expect(startImportJob(report.jobId, actor, false)).rejects.toBeInstanceOf(BadRequestError);
    expect(await AssetModel.count()).toBe(0);

    await startImportJob(report.jobId, actor, true);
    const done = await waitForStatus(report.jobId, actor, "DONE");
    expect(done.meta).toMatchObject({ ok: 2, failed: 0, skipInvalid: true });
    const result = await buildImportJobResultCsv(report.jobId, actor);
    expect(result).toContain("4,,INVALIDA,,product: El producto 'No existe' no existe");
  });

  it("una fila que falla en la carga no detiene las demas y queda como ERROR con el tag existente", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const report = await validateAndCreateImportJob(actor, "carga.csv", csv(validLines(3, product.name, costCenter.code)));

    // Entre la validacion y la carga alguien da de alta la serie de la fila 2 (fila 3 del archivo).
    const [taken] = await createAssetsFromReceipt({
      goodsReceiptId: 960000 + ++seq,
      productId: String(product._id),
      quantity: 1,
      costCenterId: costCenter.id,
      serialNumbers: ["SN-JOB-2"],
      finalStatusCode: "AVAILABLE",
    });

    await startImportJob(report.jobId, actor, false);
    const done = await waitForStatus(report.jobId, actor, "DONE");

    expect(done.meta).toMatchObject({ ok: 2, failed: 1, cursor: 3 });
    expect(await AssetModel.count()).toBe(3);
    const result = await buildImportJobResultCsv(report.jobId, actor);
    expect(result).toContain(`3,SN-JOB-2,ERROR,,Ya existe un activo con esa serie (tag ${taken!.tag})`);
  });
});

describe("acceso", () => {
  it("solo el dueno o un admin ven, inician, reanudan o cancelan una carga", async () => {
    const owner = await createActor();
    const stranger = await createActor();
    const admin = await createActor(true);
    const { costCenter, product } = await createCatalog();
    const { jobId } = await validateAndCreateImportJob(owner, "carga.csv", csv(validLines(1, product.name, costCenter.code)));

    // 404 (no 403): un tercero no debe poder distinguir "existe pero no es mia" de "no existe".
    await expect(getImportJobStatus(jobId, stranger)).rejects.toBeInstanceOf(NotFoundError);
    await expect(buildImportJobResultCsv(jobId, stranger)).rejects.toBeInstanceOf(NotFoundError);
    await expect(startImportJob(jobId, stranger, false)).rejects.toBeInstanceOf(NotFoundError);
    await expect(resumeImportJob(jobId, stranger)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelImportJob(jobId, stranger)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getImportJobStatus(jobId, admin)).meta.ownerUserId).toBe(owner.userId);
    // Nada de lo anterior cambio el trabajo.
    expect((await getImportJobStatus(jobId, owner)).meta.status).toBe("VALIDATED");
  });

  it("una carga inexistente o con un id que no es UUID responde 404", async () => {
    const actor = await createActor();
    await expect(getImportJobStatus("00000000-0000-4000-8000-00000000dead", actor)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getImportJobStatus("imp:*", actor)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("un usuario solo puede tener una carga en curso a la vez", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const first = await validateAndCreateImportJob(actor, "a.csv", csv(validLines(2, product.name, costCenter.code, "SN-A")));
    await holdLease(first.jobId); // la primera queda "en curso" sin que nadie la procese
    await startImportJob(first.jobId, actor, false);
    // Validar otro archivo no descarta una carga ya iniciada (solo los borradores sin iniciar).
    const second = await validateAndCreateImportJob(actor, "b.csv", csv(validLines(2, product.name, costCenter.code, "SN-B")));
    await expect(startImportJob(second.jobId, actor, false)).rejects.toBeInstanceOf(ConflictError);

    // Al cancelar la primera queda libre el cupo.
    await cancelImportJob(first.jobId, actor);
    await startImportJob(second.jobId, actor, false);
    await waitForStatus(second.jobId, actor, "DONE");
  });
});

describe("reanudacion", () => {
  // Deja Redis y Postgres tal como los deja una caida: las primeras `committed` filas estan creadas en Postgres, Redis
  // solo alcanzo a registrar `recorded` y el trabajo quedo RUNNING con un lease de un worker que ya no existe.
  async function crashAfter(jobId: string, actor: ImportActor, committed: number, recorded: number): Promise<string[]> {
    const rows = await readRows(jobId);
    const startedAt = new Date().toISOString();
    for (const part of ["meta", "rows", "issues"] as const) await redis.persist(importJobKey(jobId, part));
    const tags: string[] = [];
    for (const row of rows.slice(0, committed)) {
      const created = await createAssetForImportRow(row, { jobId, actorUserId: actor.userId, jobStartedAt: new Date(startedAt), mayAdopt: false });
      tags.push(created.tag);
    }
    const results: Record<string, string> = {};
    tags.slice(0, recorded).forEach((tag, index) => {
      results[String(index)] = JSON.stringify({ ok: true, tag } satisfies ImportRowResult);
    });
    if (recorded > 0) await redis.hSet(importJobKey(jobId, "res"), results);
    await redis.hSet(importJobKey(jobId, "meta"), {
      status: "RUNNING",
      startedAt,
      attempts: "1",
      ok: String(recorded),
      cursor: String(recorded),
      inflight: String(recorded),
    });
    await redis.set(importActiveJobKey(actor.userId), jobId);
    return tags;
  }

  it("retoma desde el cursor y adopta la fila ya confirmada en Postgres sin duplicar", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const { jobId } = await validateAndCreateImportJob(actor, "carga.csv", csv(validLines(6, product.name, costCenter.code)));

    // Postgres confirmo 4 filas; Redis solo registro 3 (la 4ª quedo "en vuelo").
    await holdLease(jobId);
    const tags = await crashAfter(jobId, actor, 4, 3);
    expect(await AssetModel.count()).toBe(4);
    await redis.del(importJobKey(jobId, "lease")); // el lease del worker caido vence

    await runImportJob(jobId);

    const done = await getImportJobStatus(jobId, actor);
    expect(done.meta).toMatchObject({ status: "DONE", ok: 6, failed: 0, cursor: 6, inflight: -1, attempts: 2 });
    expect(await AssetModel.count()).toBe(6);
    const serials = (await AssetModel.findAll({ attributes: ["serialNumber"] })).map((asset) => asset.serialNumber);
    expect(new Set(serials).size).toBe(6);

    const result = await buildImportJobResultCsv(jobId, actor);
    // La fila adoptada conserva el tag que ya tenia y se marca como confirmada antes.
    expect(result).toContain(`5,SN-JOB-4,OK,${tags[3]},Confirmada en un intento anterior`);
    expect(result.match(/,OK,ACT\d{9},/g)).toHaveLength(6);
  });

  it("si Redis alcanzo a registrar todas las filas confirmadas, solo procesa las que faltan", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const { jobId } = await validateAndCreateImportJob(actor, "carga.csv", csv(validLines(4, product.name, costCenter.code)));

    await holdLease(jobId);
    await crashAfter(jobId, actor, 2, 2);
    await redis.del(importJobKey(jobId, "lease"));
    await runImportJob(jobId);

    expect((await getImportJobStatus(jobId, actor)).meta).toMatchObject({ status: "DONE", ok: 4, failed: 0 });
    expect(await AssetModel.count()).toBe(4);
  });

  it("un worker no toma un trabajo que otro tiene con lease vigente", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const { jobId } = await validateAndCreateImportJob(actor, "carga.csv", csv(validLines(3, product.name, costCenter.code)));
    await holdLease(jobId);
    await startImportJob(jobId, actor, false);

    await runImportJob(jobId);
    const resumed = await resumeImportJob(jobId, actor);

    expect(resumed.alreadyProcessing).toBe(true);
    expect(await AssetModel.count()).toBe(0);
    expect((await getImportJobStatus(jobId, actor)).meta).toMatchObject({ status: "RUNNING", cursor: 0, attempts: 0 });
  });

  it("el barrido retoma un trabajo en curso cuyo lease vencio", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const { jobId } = await validateAndCreateImportJob(actor, "carga.csv", csv(validLines(3, product.name, costCenter.code)));
    await holdLease(jobId);
    await crashAfter(jobId, actor, 1, 1);
    await redis.del(importJobKey(jobId, "lease"));

    await sweepStalledImportJobs();

    const done = await waitForStatus(jobId, actor, "DONE");
    expect(done.meta).toMatchObject({ ok: 3, failed: 0 });
    expect(await AssetModel.count()).toBe(3);
  });

  it("un trabajo cuyas filas ya no estan en Redis se marca FAILED sin crear nada", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const { jobId } = await validateAndCreateImportJob(actor, "carga.csv", csv(validLines(2, product.name, costCenter.code)));
    await holdLease(jobId);
    await startImportJob(jobId, actor, false);
    await redis.del([importJobKey(jobId, "rows"), importJobKey(jobId, "lease")]);

    // start ya lanzo un intento en segundo plano (fallido por el lease ajeno) que puede seguir en curso: se reintenta
    // hasta que un worker tome el trabajo.
    for (let attempt = 0; attempt < 50; attempt++) {
      await runImportJob(jobId);
      if ((await getImportJobStatus(jobId, actor)).meta.status !== "RUNNING") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect((await getImportJobStatus(jobId, actor)).meta.status).toBe("FAILED");
    expect(await AssetModel.count()).toBe(0);
    expect(await redis.get(importActiveJobKey(actor.userId))).toBeNull();
  });
});

describe("cancelacion", () => {
  it("una carga cancelada no procesa mas filas y no se puede cancelar dos veces", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const { jobId } = await validateAndCreateImportJob(actor, "carga.csv", csv(validLines(3, product.name, costCenter.code)));
    await holdLease(jobId);
    await startImportJob(jobId, actor, false);

    const cancelled = await cancelImportJob(jobId, actor);
    expect(cancelled.status).toBe("CANCELLED");
    await redis.del(importJobKey(jobId, "lease"));
    await runImportJob(jobId);

    expect(await AssetModel.count()).toBe(0);
    await expect(cancelImportJob(jobId, actor)).rejects.toBeInstanceOf(ConflictError);
    await expect(startImportJob(jobId, actor, false)).rejects.toBeInstanceOf(ConflictError);
    expect(await redis.get(importActiveJobKey(actor.userId))).toBeNull();
  });
});

// Loop que empuja un trabajo hasta que sale de RUNNING: el intento lanzado por start() puede seguir en curso y
// runImportJob lo ignora a proposito mientras tanto.
async function driveUntilNotRunning(jobId: string, actor: ImportActor): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    await runImportJob(jobId);
    const { meta } = await getImportJobStatus(jobId, actor);
    if (meta.status !== "RUNNING") return meta.status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("La carga no salio de RUNNING");
}

describe("endurecimiento (revision de seguridad)", () => {
  it("dos start simultaneos del mismo trabajo: solo uno inicia y no se pisan el vencimiento ni el cupo", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const { jobId } = await validateAndCreateImportJob(actor, "a.csv", csv(validLines(3, product.name, costCenter.code)));
    await holdLease(jobId); // queda RUNNING sin que nadie lo procese

    const outcomes = await Promise.allSettled([
      startImportJob(jobId, actor, false),
      startImportJob(jobId, actor, false),
      startImportJob(jobId, actor, false),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") expect(outcome.reason).toBeInstanceOf(ConflictError);
    }
    // El trabajo en curso no vence a la hora (el segundo start no le reaplica el TTL de borrador) y conserva su cupo.
    expect(await redis.ttl(importJobKey(jobId, "meta"))).toBe(-1);
    expect(await redis.ttl(importJobKey(jobId, "rows"))).toBe(-1);
    expect(await redis.get(importActiveJobKey(actor.userId))).toBe(jobId);
  });

  it("dos cargas distintas del mismo usuario iniciadas a la vez: solo una arranca", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const a = await validateAndCreateImportJob(actor, "a.csv", csv(validLines(2, product.name, costCenter.code, "SN-A")));
    const b = await validateAndCreateImportJob(actor, "b.csv", csv(validLines(2, product.name, costCenter.code, "SN-B")));
    await holdLease(a.jobId);
    await holdLease(b.jobId);

    const outcomes = await Promise.allSettled([startImportJob(a.jobId, actor, false), startImportJob(b.jobId, actor, false)]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  });

  it("validar un archivo nuevo descarta el borrador anterior sin iniciar, pero no una carga en curso", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const first = await validateAndCreateImportJob(actor, "1.csv", csv(validLines(2, product.name, costCenter.code, "SN-1")));
    const second = await validateAndCreateImportJob(actor, "2.csv", csv(validLines(2, product.name, costCenter.code, "SN-2")));

    // El borrador anterior desaparece por completo de Redis (no solo su vencimiento).
    await expect(getImportJobStatus(first.jobId, actor)).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await redis.exists([importJobKey(first.jobId, "meta"), importJobKey(first.jobId, "rows"), importJobKey(first.jobId, "issues")]),
    ).toBe(0);
    expect((await getImportJobStatus(second.jobId, actor)).meta.status).toBe("VALIDATED");

    // Una carga ya iniciada NO se descarta al validar otro archivo.
    await holdLease(second.jobId);
    await startImportJob(second.jobId, actor, false);
    await validateAndCreateImportJob(actor, "3.csv", csv(validLines(2, product.name, costCenter.code, "SN-3")));
    expect((await getImportJobStatus(second.jobId, actor)).meta.status).toBe("RUNNING");
  });

  it("los usuarios o RUT inexistentes reciben un mensaje unico que no repite el valor, y un enumerador agota su presupuesto", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();

    const small = await validateAndCreateImportJob(
      actor,
      "a.csv",
      csv([
        `SN-1,${product.name},,${costCenter.code},ASSIGNED,fantasma,,`,
        `SN-2,${product.name},,${costCenter.code},ASSIGNED,,99.999.999-9,`,
      ]),
    );
    expect(small.issues.map((issue) => issue.message)).toEqual([
      "El usuario indicado no existe o no está activo",
      "El usuario indicado no existe o no está activo",
    ]);

    // 300 identidades inexistentes mas las 2 anteriores superan el presupuesto (300) en una hora: se rechaza con 429.
    const probing = Array.from({ length: 300 }, (_, i) => `SN-P${i},${product.name},,${costCenter.code},ASSIGNED,ghost${i},,`);
    const rejected = await validateAndCreateImportJob(actor, "b.csv", csv(probing)).catch((err: unknown) => err);
    expect(rejected).toBeInstanceOf(AppError);
    expect((rejected as AppError).statusCode).toBe(429);
  });

  it("si el dueno se desactiva a mitad de la carga, esta se cancela y no crea nada", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const { jobId } = await validateAndCreateImportJob(actor, "carga.csv", csv(validLines(3, product.name, costCenter.code)));
    await holdLease(jobId);
    await startImportJob(jobId, actor, false);
    await deactivateUser(actor.userId);
    await redis.del(importJobKey(jobId, "lease"));

    expect(await driveUntilNotRunning(jobId, actor)).toBe("CANCELLED");
    expect(await AssetModel.count()).toBe(0);
    expect(await redis.get(importActiveJobKey(actor.userId))).toBeNull();
  });

  it("si el dueno no tiene el permiso, la carga se cancela sin crear nada", async () => {
    const actor = await createActor(false, false);
    const { costCenter, product } = await createCatalog();
    const { jobId } = await validateAndCreateImportJob(actor, "carga.csv", csv(validLines(2, product.name, costCenter.code)));
    await startImportJob(jobId, actor, false);

    expect(await driveUntilNotRunning(jobId, actor)).toBe("CANCELLED");
    expect(await AssetModel.count()).toBe(0);
  });

  it("un usuario asignado que se desactiva tras validar hace fallar solo su fila", async () => {
    const actor = await createActor();
    const holder = await createActor(false, false);
    const { costCenter, product } = await createCatalog();
    const { jobId } = await validateAndCreateImportJob(
      actor,
      "carga.csv",
      csv([`SN-OK,${product.name},,${costCenter.code},,,,`, `SN-AS,${product.name},,${costCenter.code},ASSIGNED,${holder.username},,`]),
    );
    await deactivateUser(holder.userId);

    await startImportJob(jobId, actor, false);
    const done = await waitForStatus(jobId, actor, "DONE");

    expect(done.meta).toMatchObject({ ok: 1, failed: 1 });
    expect(await buildImportJobResultCsv(jobId, actor)).toContain("El usuario asignado ya no existe o no está activo");
    expect(await AssetModel.count()).toBe(1);
  });

  it("un producto inactivado tras validar hace fallar sus filas sin crear activos", async () => {
    const actor = await createActor();
    const { costCenter, product } = await createCatalog();
    const { jobId } = await validateAndCreateImportJob(actor, "carga.csv", csv(validLines(3, product.name, costCenter.code)));
    await deactivateProduct(String(product._id));

    await startImportJob(jobId, actor, false);
    const done = await waitForStatus(jobId, actor, "DONE");

    expect(done.meta).toMatchObject({ ok: 0, failed: 3 });
    expect(await AssetModel.count()).toBe(0);
  });
});
