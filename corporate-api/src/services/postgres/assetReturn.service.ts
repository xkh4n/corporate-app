import fs from "node:fs";
import path from "node:path";
import { literal, Op, QueryTypes, Transaction } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "../../models/postgres/asset.model";
import { AssetStatusModel } from "../../models/postgres/assetStatus.model";
import { CostCenterModel } from "../../models/postgres/costCenter.model";
import { AssetReturnModel, type AssetReturnScope, type AssetReturnStatus } from "../../models/postgres/assetReturn.model";
import { AssetReturnLineModel } from "../../models/postgres/assetReturnLine.model";
import { getAssetByIdOrThrow, lockAssetRow } from "./asset.service";
import { MOVEMENT_TYPES_REQUIRING_USERS, createAssetMovement, listCurrentHoldersByAssetIds } from "./assetMovement.service";
import { getCostCenterByIdOrThrow } from "./costCenter.service";
import { resolveUserLabels } from "./inventoryCount.service";
import { getProductsByIds } from "../mongo/product.service";
import { buildAssetReturnCode } from "../../library/assetReturnCode";
import { deleteIfExists, getAssetReturnsFolder, saveBuffer } from "../../library/documentStorage";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  isUniqueConstraintError,
} from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type {
  AssetReturnActor,
  AssetReturnCandidate,
  AssetReturnDetail,
  AssetReturnLineView,
  AssetReturnSummary,
  AssetReturnUserLabel,
  CreateAssetReturnInput,
  ReturnCandidatesQuery,
} from "../../types/postgres/assetReturn.types";

// Devolucion de activos a Adquisiciones TI con guia de despacho (plan 004):
//   DRAFT (se arma y se adjunta la guia) -> SENT (activos MOVE_TO_RETURNED)
//   -> RECEIVED (Adquisiciones recibio todos; cada uno queda RETURNED).
// Ver .claude/planes/004-devolucion-de-activos.html.

const MAX_ASSETS_PER_RETURN = 100;
const SEARCH_FIELDS = ["code"];

// Solo un activo en manos de alguien puede devolverse (mismo guard que
// createAssetMovement para MOVE_TO_RETURNED).
const RETURNABLE_STATUS_CODES = ["ASSIGNED", "DEVALUATED"];

// Activos que ya estan en una devolucion vigente (borrador o enviada y sin recibir). NOT EXISTS (y no
// NOT IN) para que el planificador use el indice parcial y no se rompa con NULL.
const NOT_IN_ACTIVE_RETURN = literal(
  'NOT EXISTS (SELECT 1 FROM asset_return_lines l WHERE l.asset_id = "AssetModel"."id" AND l.active)',
);

// Condicion SQL "el tenedor vigente del activo es este usuario": primer usuario del ULTIMO movimiento, si ese
// movimiento lleva tenedor. Misma regla que listCurrentHoldersByAssetIds, pero evaluable dentro de un filtro
// (los candidatos se filtran y paginan en la BD). userId se valida como entero: va interpolado.
function heldBySql(userId: number, assetIdSql = '"AssetModel"."id"'): string {
  if (!Number.isInteger(userId)) throw new BadRequestError("Usuario invalido");
  if (assetIdSql !== '"AssetModel"."id"' && !/^\d+$/.test(assetIdSql)) throw new BadRequestError("Activo invalido");
  const types = [...MOVEMENT_TYPES_REQUIRING_USERS].map((type) => `'${type}'`).join(", ");
  return `EXISTS (
       SELECT 1 FROM asset_movements m
         JOIN asset_movement_users mu ON mu.asset_movement_id = m.id
        WHERE m.id = (SELECT m2.id FROM asset_movements m2 WHERE m2.asset_id = ${assetIdSql}
                       ORDER BY m2.movement_date DESC, m2.id DESC LIMIT 1)
          AND m.movement_type IN (${types})
          AND mu.user_id = ${userId})`;
}

// Un movimiento puede asignar a varios usuarios: cualquiera de ellos es tenedor a estos efectos (el "tenedor"
// unico que se guarda en la linea es el primero, ver listCurrentHoldersByAssetIds).
async function isHeldBy(assetId: number, userId: number | null, transaction: Transaction): Promise<boolean> {
  if (userId === null) return false;
  const rows = await postgres.query<{ held: boolean }>(`SELECT ${heldBySql(userId, String(assetId))} AS held`, {
    type: QueryTypes.SELECT,
    transaction,
  });
  return rows[0]?.held === true;
}

// Borradores abiertos por solicitante: un borrador reserva sus activos (indice unico de lineas activas),
// asi que sin tope uno solo podria dejar bloqueado el inventario asignado de toda la empresa.
const MAX_OPEN_DRAFTS_PER_REQUESTER = 10;

// ---- Utilidades -------------------------------------------------------------

// FOR UPDATE sobre la cabecera: serializa agregar/quitar activos, adjuntar,
// enviar, recibir y cancelar entre las 3 replicas (un envio no puede
// intercalarse con una edicion del borrador).
async function lockReturn(id: number, transaction: Transaction): Promise<AssetReturnModel> {
  const assetReturn = await AssetReturnModel.findByPk(id, { transaction, lock: Transaction.LOCK.UPDATE });
  if (!assetReturn) throw new NotFoundError(`La devolución ${id} no existe`);
  return assetReturn;
}

// Solo el solicitante de la devolucion o un administrador puede modificarla
// (agregar/quitar activos, adjuntar la guia, enviarla o cancelarla). Se evalua
// ANTES que el estado: un tercero no debe enterarse en que estado esta.
function assertCanModify(assetReturn: AssetReturnModel, actor: AssetReturnActor): void {
  if (!actor.isAdmin && assetReturn.requestedBy !== actor.userId) {
    throw new ForbiddenError("Solo el solicitante de la devolución o un administrador puede modificarla");
  }
}

function assertStatus(assetReturn: AssetReturnModel, expected: AssetReturnStatus, action: string): void {
  if (assetReturn.status !== expected) {
    throw new ConflictError(
      `La devolución ${assetReturn.code ?? `#${assetReturn.id}`} está en estado ${assetReturn.status}: no se puede ${action}`,
    );
  }
}

async function productNamesOf(productIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(productIds.filter((id): id is string => !!id))];
  const products = await getProductsByIds(ids);
  return new Map(products.map((product) => [String(product._id), product.name]));
}

// resolveUserLabels devuelve tambien el RUT; aqui se descarta a proposito.
type UserLabels = Map<number, AssetReturnUserLabel>;

function userLabel(labels: UserLabels, userId: number | null): AssetReturnUserLabel | null {
  const label = userId !== null ? labels.get(userId) : undefined;
  return label ? { userId: label.userId, fullName: label.fullName } : null;
}

function costCenterView(center: CostCenterModel | undefined) {
  return center ? { id: center.id, code: center.code, name: center.name } : null;
}

// ---- Candidatos -------------------------------------------------------------

// Activos que se pueden agregar, ASSIGNED o DEVALUATED (en manos de alguien) y sin otra devolucion vigente.
// Segun el modo:
//  - OWN ("mis equipos"): los asignados al propio solicitante, de cualquier centro de costo (el del activo es el
//    que queda; costCenterId solo filtra).
//  - OTHERS: los del centro de costo ELEGIDO (obligatorio) que NO estan asignados al solicitante; un administrador
//    queda exento de la exclusion.
// El tenedor se resuelve al leer (no se copia).
export async function listReturnCandidates(
  query: ReturnCandidatesQuery,
  params: PaginationParams,
): Promise<{ items: AssetReturnCandidate[]; total: number }> {
  const { scope, actor } = query;
  const costCenterId = query.costCenterId ?? null;
  if (costCenterId !== null) await getCostCenterByIdOrThrow(costCenterId);
  if (scope === "OTHERS" && costCenterId === null) throw new BadRequestError("Debe indicar el centro de costo");

  const conditions = [NOT_IN_ACTIVE_RETURN, scope === "OWN" ? literal(heldBySql(actor.userId)) : null];
  if (scope === "OTHERS" && !actor.isAdmin) conditions.push(literal(`NOT ${heldBySql(actor.userId)}`));
  const { rows, count } = await AssetModel.findAndCountAll({
    where: {
      ...(costCenterId !== null ? { costCenterId } : {}),
      [Op.and]: conditions.filter((condition): condition is NonNullable<typeof condition> => condition !== null),
      ...buildSequelizeSearchWhere(params.search, ["tag", "serialNumber"], Op.iLike),
    },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: [{ model: AssetStatusModel, as: "status", required: true, where: { code: { [Op.in]: RETURNABLE_STATUS_CODES } } }],
  });

  const holders = await listCurrentHoldersByAssetIds(rows.map((asset) => asset.id));
  const labels = await resolveUserLabels([...holders.values()]);
  const names = await productNamesOf(rows.map((asset) => asset.productId));
  const centers = new Map(
    (await CostCenterModel.findAll({ where: { id: { [Op.in]: [...new Set(rows.map((asset) => asset.costCenterId).filter((id): id is number => id !== null))] } } })).map(
      (center) => [center.id, center],
    ),
  );

  return {
    items: rows.map((asset) => {
      const holderId = holders.get(asset.id);
      return {
        assetId: asset.id,
        tag: asset.tag,
        serialNumber: asset.serialNumber,
        statusCode: asset.status?.code ?? "",
        productName: asset.productId ? (names.get(asset.productId) ?? null) : null,
        holder: userLabel(labels, holderId ?? null),
        costCenter: costCenterView(asset.costCenterId !== null ? centers.get(asset.costCenterId) : undefined),
      };
    }),
    total: count,
  };
}

// ---- Alta y edicion del borrador -------------------------------------------

// Regla de tenedor por modo. En "mis equipos" (OWN) el tenedor debe ser el solicitante y el centro de costo lo
// define el activo (no se elige ni se cambia); en "equipos de otro usuario" (OTHERS) el activo no puede ser del
// solicitante: sus propios equipos se devuelven por OWN. Un administrador queda exento. El servidor es quien manda:
// el front solo filtra la lista.
async function holderScopeViolation(
  assetReturn: AssetReturnModel,
  asset: { id: number; tag: string },
  actor: AssetReturnActor,
  transaction: Transaction,
): Promise<string | null> {
  if (actor.isAdmin) return null;
  const isOwn = await isHeldBy(asset.id, assetReturn.requestedBy, transaction);
  if (assetReturn.holderScope === "OWN" && !isOwn) {
    return `El activo ${asset.tag} no está asignado a usted: use la devolución de equipos de otro usuario`;
  }
  if (assetReturn.holderScope === "OTHERS" && isOwn) {
    return `El activo ${asset.tag} está asignado a usted: devuélvalo como «mis equipos» (el centro de costo lo define el activo)`;
  }
  return null;
}

// Agrega activos a un borrador dentro de la transaccion de quien llama. Cada
// activo se bloquea, se re-lee y se valida (estado, centro de costo, sin otra
// devolucion vigente): cualquier fallo revierte TODA la operacion.
async function addLines(
  assetReturn: AssetReturnModel,
  assetIds: number[],
  actor: AssetReturnActor,
  transaction: Transaction,
): Promise<void> {
  const ids = [...new Set(assetIds)].sort((a, b) => a - b);
  const current = await AssetReturnLineModel.count({
    where: { assetReturnId: assetReturn.id, active: true },
    transaction,
  });
  if (current + ids.length > MAX_ASSETS_PER_RETURN) {
    throw new BadRequestError(`Una devolución admite hasta ${MAX_ASSETS_PER_RETURN} activos`);
  }

  for (const assetId of ids) {
    await lockAssetRow(assetId, transaction);
    const asset = await getAssetByIdOrThrow(assetId, transaction);
    const statusCode = asset.status?.code ?? "";
    if (!RETURNABLE_STATUS_CODES.includes(statusCode)) {
      throw new ConflictError(`El activo ${asset.tag} no se puede devolver (estado actual: ${statusCode || "desconocido"})`);
    }
    if (asset.costCenterId !== assetReturn.costCenterId) {
      throw new ConflictError(`El activo ${asset.tag} no pertenece al centro de costo de la devolución`);
    }

    // Leido DESPUES de bloquear el activo: una reasignacion concurrente ya no puede dejar un tenedor viejo.
    const holderUserId = (await listCurrentHoldersByAssetIds([assetId], transaction)).get(assetId) ?? null;
    const violation = await holderScopeViolation(assetReturn, asset, actor, transaction);
    if (violation) throw new ConflictError(violation);

    const other = await AssetReturnLineModel.findOne({
      where: { assetId, active: true },
      include: [{ model: AssetReturnModel, as: "assetReturn" }],
      transaction,
    });
    if (other) {
      throw new ConflictError(
        `El activo ${asset.tag} ya está en la devolución vigente ${other.assetReturn?.code ?? `#${other.assetReturnId}`}`,
      );
    }

    await AssetReturnLineModel.create(
      {
        assetReturnId: assetReturn.id,
        assetId,
        holderUserId,
        previousStatusCode: statusCode,
        active: true,
        receivedAt: null,
        receivedBy: null,
      },
      { transaction },
    );
  }
}

// Una carrera contra otro borrador que toma el mismo activo pierde contra el
// indice unico parcial (ux_asset_return_lines_active_asset).
function translateUnique(err: unknown): never {
  if (isUniqueConstraintError(err)) {
    throw new ConflictError("Alguno de los activos ya está en otra devolución vigente");
  }
  throw err;
}

// En OWN el centro de costo no se elige: es el de los activos (deben compartirlo). Se lee ANTES de abrir la
// transaccion; addLines vuelve a validar cada activo bajo lock.
async function resolveCostCenterId(input: CreateAssetReturnInput, scope: AssetReturnScope): Promise<number> {
  if (scope === "OTHERS") {
    if (!input.costCenterId) throw new BadRequestError("Debe indicar el centro de costo");
    await getCostCenterByIdOrThrow(input.costCenterId);
    return input.costCenterId;
  }
  const assets = await AssetModel.findAll({ where: { id: { [Op.in]: input.assetIds } }, attributes: ["id", "costCenterId"] });
  if (assets.length !== new Set(input.assetIds).size) throw new NotFoundError("Alguno de los activos no existe");
  const centers = new Set(assets.map((asset) => asset.costCenterId));
  if (centers.size !== 1 || centers.has(null)) {
    throw new ConflictError("Los equipos pertenecen a distintos centros de costo: haga una devolución por cada centro de costo");
  }
  const derived = [...centers][0]!;
  if (input.costCenterId && input.costCenterId !== derived) {
    throw new ConflictError("En «mis equipos» el centro de costo lo define el activo y no se puede cambiar");
  }
  return derived;
}

export async function createAssetReturn(input: CreateAssetReturnInput): Promise<AssetReturnDetail> {
  const scope: AssetReturnScope = input.scope ?? "OTHERS";
  const costCenterId = await resolveCostCenterId(input, scope);
  const actor: AssetReturnActor = { userId: input.requestedBy, isAdmin: input.isAdmin ?? false };
  let id: number;
  try {
    id = await postgres.transaction(async (transaction) => {
      // Serializa las altas del MISMO solicitante: sin esto, dos POST simultaneos ven 9 borradores y crean 11.
      await postgres.query(`SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))`, {
        replacements: { key: `asset-return-drafts:${input.requestedBy}` },
        type: QueryTypes.SELECT,
        transaction,
      });
      const openDrafts = await AssetReturnModel.count({
        where: { requestedBy: input.requestedBy, status: "DRAFT" },
        transaction,
      });
      if (openDrafts >= MAX_OPEN_DRAFTS_PER_REQUESTER) {
        throw new ConflictError(
          `Ya tiene ${openDrafts} devoluciones en borrador: envíe o cancele alguna antes de crear otra`,
        );
      }
      const assetReturn = await AssetReturnModel.create(
        {
          code: null,
          costCenterId,
          holderScope: scope,
          status: "DRAFT",
          documentFilename: null,
          notes: input.notes?.trim() || null,
          requestedBy: input.requestedBy,
          sentAt: null,
          sentBy: null,
          receivedAt: null,
        },
        { transaction },
      );
      await addLines(assetReturn, input.assetIds, actor, transaction);
      return assetReturn.id;
    });
  } catch (err) {
    return translateUnique(err);
  }
  return getAssetReturnDetail(id);
}

export async function addAssetReturnLines(
  id: number,
  assetIds: number[],
  actor: AssetReturnActor,
): Promise<AssetReturnDetail> {
  try {
    await postgres.transaction(async (transaction) => {
      const assetReturn = await lockReturn(id, transaction);
      assertCanModify(assetReturn, actor);
      assertStatus(assetReturn, "DRAFT", "modificar sus activos");
      await addLines(assetReturn, assetIds, actor, transaction);
    });
  } catch (err) {
    return translateUnique(err);
  }
  return getAssetReturnDetail(id);
}

export async function removeAssetReturnLine(
  id: number,
  lineId: number,
  actor: AssetReturnActor,
): Promise<AssetReturnDetail> {
  await postgres.transaction(async (transaction) => {
    const assetReturn = await lockReturn(id, transaction);
    assertCanModify(assetReturn, actor);
    assertStatus(assetReturn, "DRAFT", "modificar sus activos");
    const line = await AssetReturnLineModel.findOne({ where: { id: lineId, assetReturnId: id }, transaction });
    if (!line) throw new NotFoundError(`La línea ${lineId} no pertenece a la devolución ${id}`);
    await line.destroy({ transaction });
  });
  return getAssetReturnDetail(id);
}

// ---- Guia de despacho -------------------------------------------------------

// Chequeo BARATO previo a la subida (sin lock): la ruta lo corre ANTES de recibir y sanear el archivo, para que un
// tercero o una devolucion que ya no es borrador no gasten CPU/RAM de qpdf. La validacion definitiva sigue siendo la
// de attachAssetReturnDocument, bajo lock.
export async function assertDocumentUploadAllowed(id: number, actor: AssetReturnActor): Promise<void> {
  const assetReturn = await AssetReturnModel.findByPk(id);
  if (!assetReturn) throw new NotFoundError(`La devolución ${id} no existe`);
  assertCanModify(assetReturn, actor);
  assertStatus(assetReturn, "DRAFT", "adjuntar la guía");
}

// Adjunta (o reemplaza, mientras siga en borrador) la guia. La primera vez
// asigna el codigo, que es tambien el nombre del archivo:
// DEV<centro><aaaammddHHmmssSSS>.pdf. El UPDATE con el codigo va ANTES de
// escribir el archivo y ambos dentro de la transaccion: si el codigo choca con
// otra devolucion (UNIQUE) no se sobrescribe su PDF, y si la escritura falla
// se revierte el codigo. Solo PDF.
export async function attachAssetReturnDocument(
  id: number,
  file: Express.Multer.File,
  actor: AssetReturnActor,
): Promise<{ code: string; filename: string }> {
  if (file.mimetype !== "application/pdf") {
    throw new BadRequestError("La guía de despacho debe ser un archivo PDF");
  }
  // Codigo NUEVO cuyo archivo ya se escribio: si la transaccion falla despues (p. ej. en el commit) el
  // archivo queda huerfano, porque el siguiente intento genera otro codigo. Solo se registra tras escribir:
  // un choque de codigo UNIQUE ocurre ANTES de escribir y no debe borrar el PDF de otra devolucion.
  let writtenNewFile: string | null = null;
  try {
    return await postgres.transaction(async (transaction) => {
    const assetReturn = await lockReturn(id, transaction);
    assertCanModify(assetReturn, actor);
    assertStatus(assetReturn, "DRAFT", "adjuntar la guía");

    const isFirstAttach = assetReturn.code === null;
    let code = assetReturn.code;
    if (!code) {
      const costCenter = await CostCenterModel.findByPk(assetReturn.costCenterId, { transaction });
      if (!costCenter) throw new NotFoundError(`El centro de costo ${assetReturn.costCenterId} no existe`);
      code = buildAssetReturnCode(costCenter.code, new Date());
    }
    const filename = `${code}.pdf`;
    try {
      await assetReturn.update({ code, documentFilename: filename }, { transaction });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictError("Se generó un código de devolución repetido, intente adjuntar nuevamente");
      }
      throw err;
    }
    saveBuffer(getAssetReturnsFolder(), filename, file.buffer);
    if (isFirstAttach) writtenNewFile = filename;
    return { code, filename };
    });
  } catch (err) {
    if (writtenNewFile) deleteIfExists(getAssetReturnsFolder(), writtenNewFile);
    throw err;
  }
}

// Ruta de la guia en disco. El nombre viene de la BD (lo genero el servidor),
// aun asi se reduce a basename por defensa en profundidad.
export async function getAssetReturnDocument(id: number): Promise<{ filePath: string; filename: string }> {
  const assetReturn = await AssetReturnModel.findByPk(id);
  if (!assetReturn) throw new NotFoundError(`La devolución ${id} no existe`);
  if (!assetReturn.documentFilename) throw new NotFoundError("La devolución no tiene guía de despacho adjunta");
  const filename = path.basename(assetReturn.documentFilename);
  const filePath = path.join(getAssetReturnsFolder(), filename);
  if (!fs.existsSync(filePath)) throw new NotFoundError("La guía de despacho no se encuentra en el almacenamiento");
  return { filePath, filename };
}

// ---- Envio, recepcion y cancelacion ------------------------------------------

// "Enviar a Adquisiciones": exige guia y al menos un activo. Re-valida cada
// activo (pudo cambiar desde que se agrego al borrador: p. ej. una toma de
// inventario lo reasigno o lo movio de centro) y, si alguno ya no es valido, NO
// envia nada y los lista. Todo o nada, en una sola transaccion.
export async function sendAssetReturn(id: number, actor: AssetReturnActor): Promise<AssetReturnDetail> {
  await postgres.transaction(async (transaction) => {
    const assetReturn = await lockReturn(id, transaction);
    assertCanModify(assetReturn, actor);
    assertStatus(assetReturn, "DRAFT", "enviar");
    if (!assetReturn.code || !assetReturn.documentFilename) {
      throw new BadRequestError("Adjunte la guía de despacho antes de enviar la devolución");
    }
    const lines = await AssetReturnLineModel.findAll({
      where: { assetReturnId: id, active: true },
      order: [["assetId", "ASC"]],
      transaction,
    });
    if (lines.length === 0) throw new BadRequestError("La devolución no tiene activos");
    if (!fs.existsSync(path.join(getAssetReturnsFolder(), path.basename(assetReturn.documentFilename)))) {
      throw new BadRequestError("La guía adjunta no se encuentra en el almacenamiento: adjúntela nuevamente");
    }

    const problems: string[] = [];
    for (const line of lines) {
      await lockAssetRow(line.assetId, transaction);
      const asset = await getAssetByIdOrThrow(line.assetId, transaction);
      const statusCode = asset.status?.code ?? "";
      if (!RETURNABLE_STATUS_CODES.includes(statusCode)) {
        problems.push(`${asset.tag} (estado actual: ${statusCode || "desconocido"})`);
      } else if (asset.costCenterId !== assetReturn.costCenterId) {
        problems.push(`${asset.tag} (cambió de centro de costo)`);
      } else if (await holderScopeViolation(assetReturn, asset, actor, transaction)) {
        // Cambio de tenedor desde que se armo el borrador (p. ej. una toma de inventario lo reasigno).
        problems.push(`${asset.tag} (cambió de tenedor y ya no corresponde a esta devolución)`);
      } else {
        // El tenedor que queda registrado es el del momento del DESPACHO: pudo reasignarse desde que
        // se agrego al borrador.
        const holderNow = (await listCurrentHoldersByAssetIds([line.assetId], transaction)).get(line.assetId) ?? null;
        if (holderNow !== line.holderUserId) await line.update({ holderUserId: holderNow }, { transaction });
      }
    }
    if (problems.length > 0) {
      throw new ConflictError(
        `No se envió la devolución: estos activos ya no se pueden devolver: ${problems.join(", ")}. Quítelos e intente de nuevo.`,
      );
    }

    for (const line of lines) {
      await createAssetMovement(
        { assetId: line.assetId, movementType: "MOVE_TO_RETURNED", notes: `Devolución ${assetReturn.code}`, createdBy: actor.userId },
        transaction,
      );
    }
    await assetReturn.update({ status: "SENT", sentAt: new Date(), sentBy: actor.userId }, { transaction });
  });
  return getAssetReturnDetail(id);
}

// Recepcion en Adquisiciones: por activo (lineIds) o todos los pendientes (sin
// lineIds). Cada uno pasa de MOVE_TO_RETURNED a RETURNED; cuando no queda
// ninguno pendiente la devolucion pasa a RECEIVED.
export async function receiveAssetReturn(
  id: number,
  lineIds: number[] | undefined,
  actor: AssetReturnActor,
): Promise<AssetReturnDetail> {
  await postgres.transaction(async (transaction) => {
    const assetReturn = await lockReturn(id, transaction);
    // Separacion de funciones: ni quien solicito la devolucion ni quien la envio puede recibirla (un
    // administrador queda exento). Cubre el caso de un admin que envia por cuenta del solicitante.
    if (!actor.isAdmin && (assetReturn.sentBy === actor.userId || assetReturn.requestedBy === actor.userId)) {
      throw new ForbiddenError("Quien solicitó o envió la devolución no puede recibirla");
    }
    assertStatus(assetReturn, "SENT", "recibir");

    const pending = await AssetReturnLineModel.findAll({
      where: { assetReturnId: id, receivedAt: null, active: true },
      order: [["assetId", "ASC"]],
      transaction,
    });

    let selected = pending;
    if (lineIds) {
      const wanted = new Set(lineIds);
      const unknown = lineIds.filter((lineId) => !pending.some((line) => line.id === lineId));
      if (unknown.length > 0) {
        throw new BadRequestError(`Las líneas ${unknown.join(", ")} no están pendientes de recepción en esta devolución`);
      }
      selected = pending.filter((line) => wanted.has(line.id));
    }
    if (selected.length === 0) throw new BadRequestError("No hay activos pendientes de recibir");

    const now = new Date();
    for (const line of selected) {
      await createAssetMovement(
        {
          assetId: line.assetId,
          movementType: "RETURNED",
          notes: `Recibido en Adquisiciones (devolución ${assetReturn.code})`,
          createdBy: actor.userId,
        },
        transaction,
      );
      // active=false libera el activo para una devolucion futura.
      await line.update({ receivedAt: now, receivedBy: actor.userId, active: false }, { transaction });
    }

    if (pending.length === selected.length) {
      await assetReturn.update({ status: "RECEIVED", receivedAt: now }, { transaction });
    }
  });
  return getAssetReturnDetail(id);
}

// Solo un borrador se cancela: libera los activos (las lineas quedan inactivas
// como historial) y borra la guia. Una devolucion ya enviada no se revierte.
export async function cancelAssetReturn(id: number, actor: AssetReturnActor): Promise<AssetReturnDetail> {
  const documentFilename = await postgres.transaction(async (transaction) => {
    const assetReturn = await lockReturn(id, transaction);
    assertCanModify(assetReturn, actor);
    assertStatus(assetReturn, "DRAFT", "cancelar");
    await AssetReturnLineModel.update({ active: false }, { where: { assetReturnId: id }, transaction });
    await assetReturn.update({ status: "CANCELLED" }, { transaction });
    return assetReturn.documentFilename;
  });
  // Best-effort y fuera de la transaccion: el archivo huerfano no rompe nada.
  if (documentFilename) deleteIfExists(getAssetReturnsFolder(), path.basename(documentFilename));
  return getAssetReturnDetail(id);
}

// ---- Lectura ------------------------------------------------------------------

async function lineCounts(ids: number[]): Promise<Map<number, { lineCount: number; receivedCount: number }>> {
  const counts = new Map<number, { lineCount: number; receivedCount: number }>();
  if (ids.length === 0) return counts;
  const rows = await postgres.query<{ asset_return_id: number; line_count: number; received_count: number }>(
    `SELECT asset_return_id,
            COUNT(*)::int AS line_count,
            COUNT(received_at)::int AS received_count
       FROM asset_return_lines
      WHERE asset_return_id IN (:ids)
      GROUP BY asset_return_id`,
    { replacements: { ids }, type: QueryTypes.SELECT },
  );
  for (const row of rows) {
    counts.set(row.asset_return_id, { lineCount: row.line_count, receivedCount: row.received_count });
  }
  return counts;
}

export async function listAssetReturns(
  params: PaginationParams,
): Promise<{ items: AssetReturnSummary[]; total: number }> {
  const statuses = params.status?.filter((status) => ["DRAFT", "SENT", "RECEIVED", "CANCELLED"].includes(status));
  const { rows, count } = await AssetReturnModel.findAndCountAll({
    where: {
      ...buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.iLike),
      ...(statuses && statuses.length > 0 ? { status: { [Op.in]: statuses } } : {}),
    },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: [{ model: CostCenterModel, as: "costCenter" }],
  });

  const counts = await lineCounts(rows.map((row) => row.id));
  const labels = await resolveUserLabels(rows.map((row) => row.requestedBy));
  return {
    items: rows.map((row) => toSummary(row, counts.get(row.id), labels)),
    total: count,
  };
}

function toSummary(
  row: AssetReturnModel,
  counts: { lineCount: number; receivedCount: number } | undefined,
  labels: UserLabels,
): AssetReturnSummary {
  return {
    id: row.id,
    code: row.code,
    scope: row.holderScope,
    status: row.status,
    costCenter: costCenterView(row.costCenter),
    notes: row.notes,
    requestedBy: userLabel(labels, row.requestedBy),
    hasDocument: row.documentFilename !== null,
    lineCount: counts?.lineCount ?? 0,
    receivedCount: counts?.receivedCount ?? 0,
    sentAt: row.sentAt,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
  };
}

export async function getAssetReturnDetail(id: number): Promise<AssetReturnDetail> {
  const row = await AssetReturnModel.findByPk(id, { include: [{ model: CostCenterModel, as: "costCenter" }] });
  if (!row) throw new NotFoundError(`La devolución ${id} no existe`);

  const lines = await AssetReturnLineModel.findAll({
    where: { assetReturnId: id },
    order: [["id", "ASC"]],
    include: [{ model: AssetModel, as: "asset", include: [{ model: AssetStatusModel, as: "status" }] }],
  });

  const labels = await resolveUserLabels([row.requestedBy, row.sentBy, ...lines.map((line) => line.holderUserId)]);
  const names = await productNamesOf(lines.map((line) => line.asset?.productId));
  const counts = await lineCounts([id]);

  const lineViews: AssetReturnLineView[] = lines.map((line) => ({
    id: line.id,
    assetId: line.assetId,
    tag: line.asset?.tag ?? "",
    serialNumber: line.asset?.serialNumber ?? null,
    productName: line.asset?.productId ? (names.get(line.asset.productId) ?? null) : null,
    holder: userLabel(labels, line.holderUserId),
    previousStatusCode: line.previousStatusCode,
    statusCode: line.asset?.status?.code ?? null,
    receivedAt: line.receivedAt,
  }));

  return {
    ...toSummary(row, counts.get(id), labels),
    sentBy: userLabel(labels, row.sentBy),
    lines: lineViews,
  };
}
