import { Op, QueryTypes, Transaction } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "../../models/postgres/asset.model";
import { AssetStatusModel } from "../../models/postgres/assetStatus.model";
import { CostCenterModel } from "../../models/postgres/costCenter.model";
import { InventoryCountModel } from "../../models/postgres/inventoryCount.model";
import { InventoryCountLineModel } from "../../models/postgres/inventoryCountLine.model";
import { InventoryCountMissingAssetModel } from "../../models/postgres/inventoryCountMissingAsset.model";
import { UserModel } from "../../models/mssql/user.model";
import { PersonModel } from "../../models/mssql/person.model";
import {
  createAssetFromInventory,
  findAssetsBySerial,
  getAssetByIdOrThrow,
  getAssetByTag,
  getAssetsLabelData,
  lockAssetRow,
  setAssetStatus,
  updateAssetLocation,
} from "./asset.service";
import { createAssetMovement, findOpenSupportTicketNumber, listCurrentHoldersByAssetIds } from "./assetMovement.service";
import { applyDeclaredStatusToNewAsset, lockAssetSerial } from "./assetIntake.service";
import { getAssetStatusByCodeOrThrow } from "./assetStatus.service";
import { getCostCenterByIdOrThrow } from "./costCenter.service";
import { getUserByIdOrThrow } from "../mssql/user.service";
import { getProductById, getProductByIdOrThrow, getProductsByIds } from "../mongo/product.service";
import { getProductCategoriesByIds, getProductCategoryByIdOrThrow } from "../mongo/productCategory.service";
import { computeLineChanges, needsSupportFollowUp } from "../../library/inventoryCountChanges";
import {
  allowedDeclaredStatuses,
  forcedDeclaredStatus,
  instructionFor,
  planExistingAssetChange,
} from "../../library/inventoryAssetTransition";
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
  AddInventoryLineInput,
  InventoryCountActor,
  InventoryCountSummary,
  InventoryLookup,
  InventoryLookupBy,
  InventoryReportLine,
  InventoryReportMissingAsset,
  InventoryUserLabel,
  StartInventoryCountInput,
  UpdateInventoryLineInput,
} from "../../types/postgres/inventoryCount.types";

const COUNT_NUMBER_PAD = 6;
const SEARCH_FIELDS = ["number", "name"];

// Estados en los que el activo esta en manos de un usuario (tiene tenedor vigente).
const HOLDER_STATUSES = new Set(["ASSIGNED", "DEVALUATED"]);

// Folio legible por anio (ITAAAANNNNNN, sin guiones; las tomas anteriores
// conservan IT-AAAA-NNNNNN). El upsert con RETURNING es el
// incremento atomico -mismo criterio que generateAssetTag-, y dentro de la
// transaccion de quien llama: si esa transaccion se revierte, el folio no se
// consume.
async function generateInventoryCountNumber(transaction: Transaction): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await postgres.query<{ next_seq: number }>(
    `INSERT INTO inventory_count_counters (year, next_seq) VALUES (:year, 1)
     ON CONFLICT (year) DO UPDATE SET next_seq = inventory_count_counters.next_seq + 1
     RETURNING next_seq`,
    { replacements: { year }, type: QueryTypes.SELECT, transaction },
  );
  const nextSeq = rows[0]?.next_seq;
  if (nextSeq === undefined) throw new Error(`No se pudo generar el folio de toma de inventario ${year}`);
  return `IT${year}${String(nextSeq).padStart(COUNT_NUMBER_PAD, "0")}`;
}

export async function getInventoryCountById(id: number, transaction?: Transaction): Promise<InventoryCountModel | null> {
  return InventoryCountModel.findByPk(id, { transaction });
}

export async function getInventoryCountByIdOrThrow(id: number, transaction?: Transaction): Promise<InventoryCountModel> {
  const count = await getInventoryCountById(id, transaction);
  if (!count) throw new NotFoundError(`La toma de inventario ${id} no existe`);
  return count;
}

// Solo el auditor que abrio la toma (o un administrador) la modifica: ingresar equipos (lo que
// puede cambiar el estado, el usuario y el centro de costo de un activo real), corregir o quitar
// lineas y cerrarla. Se evalua ANTES que el estado: un tercero no debe enterarse de si esta abierta.
function assertAuditor(count: InventoryCountModel, actor: InventoryCountActor, action: string): void {
  if (!actor.isAdmin && count.createdBy !== actor.userId) {
    throw new ForbiddenError(`Solo el auditor que inició la toma o un administrador puede ${action}`);
  }
}

// Lectura de las lineas/informe/etiquetas de una toma ABIERTA: solo el auditor o un admin (trae RUT y el detalle
// de lo que se esta ingresando). Una toma cerrada la puede leer quien tenga inventory-counts:read.
export function assertCanReadOpenCount(count: InventoryCountModel, actor: InventoryCountActor): void {
  if (count.status === "OPEN") assertAuditor(count, actor, "ver sus equipos mientras está abierta");
}

// Lee la cabecera con un lock de fila DENTRO de la transaccion y exige que siga
// OPEN. SHARE para agregar/editar lineas (no se bloquean entre si), UPDATE para cerrar: el
// cierre espera a las escrituras en curso y las escrituras posteriores ven la toma ya CLOSED.
async function lockOpenCount(
  id: number,
  transaction: Transaction,
  mode: "SHARE" | "UPDATE",
): Promise<InventoryCountModel> {
  const count = await InventoryCountModel.findByPk(id, {
    transaction,
    lock: mode === "UPDATE" ? Transaction.LOCK.UPDATE : Transaction.LOCK.SHARE,
  });
  if (!count) throw new NotFoundError(`La toma de inventario ${id} no existe`);
  if (count.status !== "OPEN") {
    throw new ConflictError(`La toma ${count.number} ya esta cerrada y no admite cambios`);
  }
  return count;
}

async function findOpenCountByCreator(createdBy: number): Promise<InventoryCountModel | null> {
  return InventoryCountModel.findOne({ where: { createdBy, status: "OPEN" } });
}

// "Inicio de Inventario". Un auditor tiene a lo sumo UNA toma abierta (indice
// unico parcial en el motor): si ya tiene una, se la devuelve (resumed) para
// que pueda retomarla en vez de fallar.
export async function startInventoryCount(
  input: StartInventoryCountInput,
): Promise<{ count: InventoryCountModel; resumed: boolean }> {
  const existing = await findOpenCountByCreator(input.createdBy);
  if (existing) return { count: existing, resumed: true };

  try {
    const count = await postgres.transaction(async (transaction) => {
      const number = await generateInventoryCountNumber(transaction);
      return InventoryCountModel.create(
        {
          number,
          name: input.name?.trim() || `Toma de inventario ${number}`,
          notes: input.notes?.trim() || null,
          status: "OPEN",
          startedAt: new Date(),
          closedAt: null,
          createdBy: input.createdBy,
          closedBy: null,
        },
        { transaction },
      );
    });
    return { count, resumed: false };
  } catch (err) {
    // Dos "Inicio" simultaneos del mismo auditor: pierde el segundo contra el
    // indice unico parcial -se le devuelve la que gano.
    if (isUniqueConstraintError(err)) {
      const raced = await findOpenCountByCreator(input.createdBy);
      if (raced) return { count: raced, resumed: true };
    }
    throw err;
  }
}

export async function listInventoryCounts(
  params: PaginationParams,
): Promise<{ items: InventoryCountModel[]; total: number }> {
  const { rows, count } = await InventoryCountModel.findAndCountAll({
    where: {
      ...buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.iLike),
      ...(params.status ? { status: { [Op.in]: params.status } } : {}),
    },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

// Totales baratos para la cabecera (sin resolver nombres ni cambios).
export async function getInventoryCountLineTotals(
  countId: number,
): Promise<{ totalLines: number; createdAssets: number }> {
  const rows = await postgres.query<{ total: string; created: string }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE asset_created) AS created
       FROM inventory_count_lines WHERE inventory_count_id = :countId`,
    { replacements: { countId }, type: QueryTypes.SELECT },
  );
  return { totalLines: Number(rows[0]?.total ?? 0), createdAssets: Number(rows[0]?.created ?? 0) };
}

// ---- Etiquetas de colaborador (PII resuelta en lectura, no copiada) --------

export async function resolveUserLabels(userIds: (number | null | undefined)[]): Promise<Map<number, InventoryUserLabel>> {
  const ids = [...new Set(userIds.filter((id): id is number => typeof id === "number"))];
  const labels = new Map<number, InventoryUserLabel>();
  if (ids.length === 0) return labels;
  const users = await UserModel.findAll({
    where: { id: { [Op.in]: ids } },
    include: [{ model: PersonModel, as: "person" }],
  });
  for (const user of users) {
    const person = user.person;
    labels.set(user.id, {
      userId: user.id,
      fullName: person ? `${person.firstName} ${person.lastName}`.trim() : user.username,
      documentId: person?.documentId ?? "",
    });
  }
  return labels;
}

// ---- Busqueda por TAG o por serie -------------------------------------------

// Encuentra el activo de un equipo por su TAG (coincidencia exacta) o por su
// serie. Una serie repetida en datos legados se rechaza en vez de elegir un
// activo al azar: hay que ingresar ese equipo por TAG.
async function findAssetByLookup(
  by: InventoryLookupBy,
  value: string,
  transaction?: Transaction,
): Promise<AssetModel | null> {
  if (by === "TAG") return getAssetByTag(value, transaction);
  const matches = await findAssetsBySerial(value, transaction);
  if (matches.length > 1) {
    throw new ConflictError(
      `La serie ${value.trim()} esta repetida en ${matches.length} activos (${matches.map((asset) => asset.tag).join(", ")}). Ingrese el equipo por TAG`,
    );
  }
  return matches[0] ?? null;
}

// Orientativo: precarga el formulario de captura al validar un TAG o una serie.
// Devuelve null si no existe (el auditor vera "se generara una etiqueta nueva").
// Incluye los estados que la toma acepta para ese activo y los avisos.
export async function lookupAsset(
  countId: number,
  by: InventoryLookupBy,
  value: string,
  actor: InventoryCountActor,
): Promise<InventoryLookup | null> {
  assertAuditor(await getInventoryCountByIdOrThrow(countId), actor, "consultar equipos en ella");
  const asset = await findAssetByLookup(by, value);
  if (!asset) return null;

  const statusCode = asset.status?.code ?? "";
  const [holders, product, existingLine] = await Promise.all([
    listCurrentHoldersByAssetIds([asset.id]),
    asset.productId ? getProductById(asset.productId) : Promise.resolve(null),
    InventoryCountLineModel.findOne({ where: { inventoryCountId: countId, assetId: asset.id }, attributes: ["id"] }),
  ]);
  const holderId = HOLDER_STATUSES.has(statusCode) ? holders.get(asset.id) : undefined;
  const labels = await resolveUserLabels([holderId]);

  return {
    assetId: asset.id,
    tag: asset.tag,
    statusCode: asset.status?.code ?? null,
    statusName: asset.status?.name ?? null,
    serialNumber: asset.serialNumber,
    costCenterId: asset.costCenterId,
    productId: asset.productId,
    productCategoryId: product?.categoryId ? String(product.categoryId) : null,
    holder: holderId !== undefined ? (labels.get(holderId) ?? null) : null,
    alreadyInCount: existingLine !== null,
    allowedStatusCodes: allowedDeclaredStatuses(statusCode),
    forcedStatusCode: forcedDeclaredStatus(statusCode),
    instruction: instructionFor(statusCode),
  };
}

// ---- Lineas ----------------------------------------------------------------

// Solo un activo en uso (ASSIGNED / DEVALUATED) tiene tenedor: con SUPPORT, DAMAGED o baja, un usuario
// tipeado se descarta, o el informe mostraria un tenedor inexistente y un HOLDER_CHANGED falso.
function holderIfInUse(resultingStatusCode: string, holderUserId: number | null): number | null {
  return HOLDER_STATUSES.has(resultingStatusCode) ? holderUserId : null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Ingreso de UN equipo en la toma. Se identifica por TAG o por serie y el
// SERVIDOR valida siempre si el activo existe (el lookup de la pantalla es solo
// orientativo):
// - Existe: la linea se VINCULA al activo y la toma lo ACTUALIZA segun el estado
//   declarado (planExistingAssetChange): p. ej. queda asignado al usuario
//   ingresado, una devolucion queda en soporte, una baja en uso queda devaluada.
//   Tambien queda en el centro de costo donde se encontro (ubicacion).
// - No existe: se CREA un activo real con un tag nuevo generado por el sistema
//   -el texto ingresado se descarta- y se le aplica el estado declarado.
// Todo en una sola transaccion Postgres.
export async function addInventoryLine(
  countId: number,
  input: AddInventoryLineInput,
  actor: InventoryCountActor,
): Promise<InventoryCountLineModel> {
  // Validaciones cross-engine (Mongo/MSSQL) antes de abrir la transaccion, mismo
  // criterio que createAssetMovement.
  assertAuditor(await getInventoryCountByIdOrThrow(countId), actor, "ingresar equipos en ella");
  await getProductCategoryByIdOrThrow(input.productCategoryId);
  const product = await getProductByIdOrThrow(input.productId);
  if (!product.categoryId || String(product.categoryId) !== input.productCategoryId) {
    throw new BadRequestError("El producto no pertenece a la categoria seleccionada");
  }
  await getCostCenterByIdOrThrow(input.costCenterId);

  const holderUserId = input.holderUserId ?? null;
  if (holderUserId !== null) await getUserByIdOrThrow(holderUserId);
  if (input.statusCode === "ASSIGNED" && holderUserId === null) {
    throw new BadRequestError("Un equipo asignado requiere indicar el usuario");
  }

  const tag = normalizeOptionalText(input.tag);
  const declaredSerial = normalizeOptionalText(input.serialNumber);
  const description = normalizeOptionalText(input.description);
  if (input.lookupBy === "TAG" && !tag) throw new BadRequestError("Debe indicar el TAG del equipo");
  if (input.lookupBy === "SERIAL" && !declaredSerial) throw new BadRequestError("Debe indicar la serie del equipo");

  try {
    const lineId = await postgres.transaction(async (transaction) => {
      const count = await lockOpenCount(countId, transaction, "SHARE");
      assertAuditor(count, actor, "ingresar equipos en ella");
      const existing = await findAssetByLookup(input.lookupBy, (input.lookupBy === "TAG" ? tag : declaredSerial) ?? "", transaction);

      if (existing) {
        return linkExistingAsset(count, existing, input, input.productId, description, holderUserId, transaction);
      }
      return createNewAsset(count, input, product.productType, declaredSerial, description, holderUserId, transaction);
    });
    return await getLineByIdOrThrow(lineId);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new ConflictError("Ese activo ya fue ingresado en esta toma");
    }
    throw err;
  }
}

// El activo existe: se vincula y se actualiza. Relee el activo BAJO LOCK dentro
// de la transaccion (otro auditor pudo cambiarlo entre la validacion y ahora).
async function linkExistingAsset(
  count: InventoryCountModel,
  found: AssetModel,
  input: AddInventoryLineInput,
  productId: string,
  description: string | null,
  holderUserId: number | null,
  transaction: Transaction,
): Promise<number> {
  await lockAssetRow(found.id, transaction);
  const asset = await getAssetByIdOrThrow(found.id, transaction);
  if (asset.productId && asset.productId !== productId) {
    throw new BadRequestError(`El activo ${asset.tag} corresponde a otro producto`);
  }

  const duplicate = await InventoryCountLineModel.findOne({
    where: { inventoryCountId: count.id, assetId: asset.id },
    transaction,
  });
  if (duplicate) throw new ConflictError(`El activo ${asset.tag} ya fue ingresado en esta toma`);

  const systemStatus = asset.status?.code ?? "";
  const holders = await listCurrentHoldersByAssetIds([asset.id], transaction);
  const systemHolder = HOLDER_STATUSES.has(systemStatus) ? (holders.get(asset.id) ?? null) : null;

  const plan = planExistingAssetChange({
    systemStatus,
    declared: input.statusCode,
    holderIsSame: holderUserId !== null && holderUserId === systemHolder,
  });
  if (!plan.ok) throw new BadRequestError(`${asset.tag}: ${plan.reason}`);
  // Un activo en soporte por un ticket vuelve desde el ticket: la toma no le cambia el estado (run-3 final, L4).
  if (systemStatus === "SUPPORT" && plan.steps.length > 0) {
    const ticketNumber = await findOpenSupportTicketNumber(asset.id, transaction);
    if (ticketNumber) {
      throw new ConflictError(`${asset.tag}: esta en soporte por el ticket ${ticketNumber}; devuelvalo desde el ticket antes de declararlo`);
    }
  }

  const notes = `Actualizado por toma de inventario ${count.number}`;
  for (const step of plan.steps) {
    if (step.kind === "SET_STATUS") {
      const status = await getAssetStatusByCodeOrThrow(step.statusCode, transaction);
      await setAssetStatus(asset.id, status.id, transaction, input.createdBy);
    } else {
      await createAssetMovement(
        {
          assetId: asset.id,
          movementType: step.movementType,
          userIds: step.withHolder && holderUserId !== null ? [holderUserId] : [],
          notes,
          createdBy: input.createdBy,
        },
        transaction,
      );
    }
  }

  const locationChanged = asset.costCenterId !== input.costCenterId;
  const productMissing = !asset.productId;
  if (locationChanged || productMissing) {
    await updateAssetLocation(
      asset.id,
      { costCenterId: input.costCenterId, productIdIfMissing: productMissing ? productId : null, updatedBy: input.createdBy },
      transaction,
    );
  }

  const line = await InventoryCountLineModel.create(
    {
      inventoryCountId: count.id,
      assetId: asset.id,
      assetCreated: false,
      productCategoryId: input.productCategoryId,
      productId: asset.productId ?? productId,
      description,
      costCenterId: input.costCenterId,
      // La serie de un activo existente se toma del activo, no del auditor.
      serialNumber: asset.serialNumber,
      holderUserId: holderIfInUse(plan.resultingStatusCode, holderUserId),
      statusCode: input.statusCode,
      systemStatusCode: systemStatus || null,
      systemHolderUserId: systemHolder,
      systemCostCenterId: asset.costCenterId,
      resultingStatusCode: plan.resultingStatusCode,
      assetModified: plan.steps.length > 0 || locationChanged || productMissing,
      createdBy: input.createdBy,
    },
    { transaction },
  );
  return line.id;
}

// El activo no existe: alta con tag generado. La serie identifica al equipo
// fisico y es obligatoria; si ya pertenece a otro activo, ese equipo ya existe.
async function createNewAsset(
  count: InventoryCountModel,
  input: AddInventoryLineInput,
  productType: Parameters<typeof createAssetFromInventory>[0]["productType"],
  declaredSerial: string | null,
  description: string | null,
  holderUserId: number | null,
  transaction: Transaction,
): Promise<number> {
  if (!declaredSerial) throw new BadRequestError("La serie es obligatoria para dar de alta un equipo nuevo");

  // Dos auditores que dan de alta la misma serie a la vez pasan ambos el chequeo de abajo y crean dos activos:
  // el lock por serie (compartido con la carga masiva) los serializa.
  await lockAssetSerial(declaredSerial, transaction);
  const sameSerial = await findAssetsBySerial(declaredSerial, transaction);
  if (sameSerial.length > 0) {
    throw new ConflictError(
      input.lookupBy === "TAG"
        ? `Ya existe un activo con la serie ${declaredSerial} (tag ${sameSerial[0]!.tag}). Ingreselo escaneando su etiqueta o buscando por serie`
        : `La serie ${declaredSerial} acaba de ser dada de alta por otra toma (tag ${sameSerial[0]!.tag}). Vuelva a validarla`,
    );
  }

  const asset = await createAssetFromInventory(
    {
      productId: input.productId,
      productType,
      costCenterId: input.costCenterId,
      serialNumber: declaredSerial,
      createdBy: input.createdBy,
    },
    transaction,
  );
  await applyDeclaredStatusToNewAsset(
    asset.id,
    input.statusCode,
    holderUserId,
    `Alta por toma de inventario ${count.number}`,
    input.createdBy,
    transaction,
  );

  const line = await InventoryCountLineModel.create(
    {
      inventoryCountId: count.id,
      assetId: asset.id,
      assetCreated: true,
      productCategoryId: input.productCategoryId,
      productId: input.productId,
      description,
      costCenterId: input.costCenterId,
      serialNumber: declaredSerial,
      holderUserId: holderIfInUse(input.statusCode, holderUserId),
      statusCode: input.statusCode,
      systemStatusCode: null,
      systemHolderUserId: null,
      systemCostCenterId: null,
      resultingStatusCode: input.statusCode,
      assetModified: false,
      createdBy: input.createdBy,
    },
    { transaction },
  );
  return line.id;
}

async function getLineByIdOrThrow(lineId: number): Promise<InventoryCountLineModel> {
  const line = await InventoryCountLineModel.findByPk(lineId, {
    include: [
      { model: AssetModel, as: "asset", include: [{ model: AssetStatusModel, as: "status" }] },
      { model: CostCenterModel, as: "costCenter" },
    ],
  });
  if (!line) throw new NotFoundError(`La linea ${lineId} no existe`);
  return line;
}

// Solo la descripcion: el estado, tenedor, serie y centro de costo ya quedaron
// escritos en el activo real y cambiarlos aqui desincronizaria la linea (se
// corrigen con un movimiento normal del activo).
export async function updateInventoryLine(
  countId: number,
  lineId: number,
  input: UpdateInventoryLineInput,
  actor: InventoryCountActor,
): Promise<InventoryCountLineModel> {
  assertAuditor(await getInventoryCountByIdOrThrow(countId), actor, "corregir sus equipos");

  await postgres.transaction(async (transaction) => {
    assertAuditor(await lockOpenCount(countId, transaction, "SHARE"), actor, "corregir sus equipos");
    const line = await InventoryCountLineModel.findOne({ where: { id: lineId, inventoryCountId: countId }, transaction });
    if (!line) throw new NotFoundError(`La linea ${lineId} no existe en esta toma`);
    if (input.description !== undefined) {
      await line.update({ description: normalizeOptionalText(input.description) }, { transaction });
    }
  });

  return getLineByIdOrThrow(lineId);
}

// Una linea solo se quita si no creo ni modifico el activo: la toma ya escribio
// esos cambios (y una etiqueta pudo imprimirse) y quitar la linea no los revierte.
export async function deleteInventoryLine(countId: number, lineId: number, actor: InventoryCountActor): Promise<void> {
  assertAuditor(await getInventoryCountByIdOrThrow(countId), actor, "quitar sus equipos");
  await postgres.transaction(async (transaction) => {
    assertAuditor(await lockOpenCount(countId, transaction, "SHARE"), actor, "quitar sus equipos");
    const line = await InventoryCountLineModel.findOne({ where: { id: lineId, inventoryCountId: countId }, transaction });
    if (!line) throw new NotFoundError(`La linea ${lineId} no existe en esta toma`);
    if (line.assetCreated) {
      throw new ConflictError(
        "El activo de esta linea fue creado por la toma y su etiqueta ya existe: no se puede quitar",
      );
    }
    if (line.assetModified) {
      throw new ConflictError(
        "La toma ya modifico el activo de esta linea (estado, usuario o centro de costo): no se puede quitar, corrijalo con un movimiento del activo",
      );
    }
    await line.destroy({ transaction });
  });
}

// ---- Cierre ----------------------------------------------------------------

// "Fin Inventario": bloquea la cabecera (espera a las escrituras en curso),
// congela los activos del sistema que no se vieron y marca CLOSED. Devuelve los
// ids de los activos creados por la toma, para imprimir sus etiquetas.
// Faltantes: cualquier estado salvo DECOMMISSIONED y MOVE_TO_RETURNED (en
// transito hacia Adquisiciones, ya no esta en el sitio; un equipo dado de baja no
// se espera encontrar).
// Cerrar es irreversible y congela la lista de faltantes: solo el auditor que abrio la toma o un
// administrador (igual que ingresar, corregir y quitar equipos: ver assertAuditor).
export async function closeInventoryCount(
  countId: number,
  actor: InventoryCountActor,
): Promise<{ count: InventoryCountModel; createdAssetIds: number[] }> {
  const closedBy = actor.userId;
  // Antes de tomar el lock UPDATE de la cabecera: un tercero no debe bloquearla ni enterarse de su estado.
  assertAuditor(await getInventoryCountByIdOrThrow(countId), actor, "cerrarla");

  return postgres.transaction(async (transaction) => {
    const count = await lockOpenCount(countId, transaction, "UPDATE");
    assertAuditor(count, actor, "cerrarla");

    const missing = await postgres.query<{ id: number; code: string }>(
      `SELECT a.id, s.code
         FROM assets a
         JOIN asset_statuses s ON s.id = a.status_id
        WHERE s.code NOT IN ('DECOMMISSIONED', 'MOVE_TO_RETURNED')
          AND NOT EXISTS (
            SELECT 1 FROM inventory_count_lines l
             WHERE l.inventory_count_id = :countId AND l.asset_id = a.id
          )
        ORDER BY a.id`,
      { replacements: { countId }, type: QueryTypes.SELECT, transaction },
    );

    if (missing.length > 0) {
      const holders = await listCurrentHoldersByAssetIds(
        missing.map((row) => row.id),
        transaction,
      );
      await InventoryCountMissingAssetModel.bulkCreate(
        missing.map((row) => ({
          inventoryCountId: countId,
          assetId: row.id,
          systemStatusCode: row.code,
          systemHolderUserId: HOLDER_STATUSES.has(row.code) ? (holders.get(row.id) ?? null) : null,
        })),
        { transaction },
      );
    }

    await count.update({ status: "CLOSED", closedAt: new Date(), closedBy }, { transaction });

    const created = await InventoryCountLineModel.findAll({
      where: { inventoryCountId: countId, assetCreated: true },
      attributes: ["assetId"],
      order: [["id", "ASC"]],
      transaction,
    });
    return { count, createdAssetIds: created.map((line) => line.assetId) };
  });
}

// ---- Lectura / reporte -----------------------------------------------------

async function buildReportLines(lines: InventoryCountLineModel[]): Promise<InventoryReportLine[]> {
  const userLabels = await resolveUserLabels(lines.flatMap((line) => [line.holderUserId, line.systemHolderUserId]));
  const products = await getProductsByIds([...new Set(lines.map((line) => line.productId))]);
  const categories = await getProductCategoriesByIds([...new Set(lines.map((line) => line.productCategoryId))]);
  const productNames = new Map(products.map((product) => [String(product._id), product.name]));
  const categoryNames = new Map(categories.map((category) => [String(category._id), category.name]));

  const systemCostCenterIds = [
    ...new Set(lines.map((line) => line.systemCostCenterId).filter((id): id is number => id !== null)),
  ];
  const systemCostCenters =
    systemCostCenterIds.length > 0
      ? await CostCenterModel.findAll({ where: { id: { [Op.in]: systemCostCenterIds } } })
      : [];
  const costCenterById = new Map(systemCostCenters.map((center) => [center.id, center]));

  return lines.map((line) => {
    // Filas anteriores al plan 003 no tienen resulting_status_code: se usa el declarado.
    const resultingStatusCode = line.resultingStatusCode ?? line.statusCode;
    const systemCostCenter = line.systemCostCenterId !== null ? costCenterById.get(line.systemCostCenterId) : undefined;
    return {
      id: line.id,
      assetId: line.assetId,
      tag: line.asset?.tag ?? "",
      assetCreated: line.assetCreated,
      categoryName: categoryNames.get(line.productCategoryId) ?? null,
      productName: productNames.get(line.productId) ?? null,
      description: line.description,
      costCenter: line.costCenter
        ? { id: line.costCenter.id, code: line.costCenter.code, name: line.costCenter.name }
        : null,
      serialNumber: line.serialNumber,
      holder: line.holderUserId !== null ? (userLabels.get(line.holderUserId) ?? null) : null,
      statusCode: resultingStatusCode,
      systemStatusCode: line.systemStatusCode,
      systemHolder: line.systemHolderUserId !== null ? (userLabels.get(line.systemHolderUserId) ?? null) : null,
      systemCostCenter: systemCostCenter
        ? { id: systemCostCenter.id, code: systemCostCenter.code, name: systemCostCenter.name }
        : null,
      changes: computeLineChanges({
        assetCreated: line.assetCreated,
        resultingStatusCode,
        holderUserId: line.holderUserId,
        costCenterId: line.costCenterId,
        systemStatusCode: line.systemStatusCode,
        systemHolderUserId: line.systemHolderUserId,
        systemCostCenterId: line.systemCostCenterId,
      }),
      supportFollowUp: needsSupportFollowUp(line),
      removable: !line.assetCreated && !line.assetModified,
      createdAt: line.createdAt,
    };
  });
}

const LINE_INCLUDE = [
  { model: AssetModel, as: "asset" },
  { model: CostCenterModel, as: "costCenter" },
];

export async function listInventoryLines(
  countId: number,
  params: PaginationParams,
): Promise<{ items: InventoryReportLine[]; total: number }> {
  await getInventoryCountByIdOrThrow(countId);
  const { rows, count } = await InventoryCountLineModel.findAndCountAll({
    where: { inventoryCountId: countId },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: LINE_INCLUDE,
  });
  return { items: await buildReportLines(rows), total: count };
}

export async function getInventoryCountReport(countId: number): Promise<{
  count: InventoryCountModel;
  auditor: InventoryUserLabel | null;
  summary: InventoryCountSummary;
  lines: InventoryReportLine[];
  missingAssets: InventoryReportMissingAsset[];
}> {
  const count = await getInventoryCountByIdOrThrow(countId);
  const lineRows = await InventoryCountLineModel.findAll({
    where: { inventoryCountId: countId },
    order: [["id", "ASC"]],
    include: LINE_INCLUDE,
  });
  const lines = await buildReportLines(lineRows);

  const missingRows = await InventoryCountMissingAssetModel.findAll({
    where: { inventoryCountId: countId },
    order: [["assetId", "ASC"]],
    include: [{ model: AssetModel, as: "asset" }],
  });
  const userLabels = await resolveUserLabels(missingRows.map((row) => row.systemHolderUserId));
  const products = await getProductsByIds([
    ...new Set(missingRows.map((row) => row.asset?.productId).filter((id): id is string => !!id)),
  ]);
  const productNames = new Map(products.map((product) => [String(product._id), product.name]));
  const missingAssets: InventoryReportMissingAsset[] = missingRows.map((row) => ({
    assetId: row.assetId,
    tag: row.asset?.tag ?? "",
    productName: row.asset?.productId ? (productNames.get(row.asset.productId) ?? null) : null,
    serialNumber: row.asset?.serialNumber ?? null,
    systemStatusCode: row.systemStatusCode,
    systemHolder: row.systemHolderUserId !== null ? (userLabels.get(row.systemHolderUserId) ?? null) : null,
  }));

  const createdAssets = lines.filter((line) => line.assetCreated).length;
  const auditorLabels = await resolveUserLabels([count.createdBy]);
  return {
    count,
    auditor: count.createdBy !== null ? (auditorLabels.get(count.createdBy) ?? null) : null,
    summary: {
      totalLines: lines.length,
      linkedLines: lines.length - createdAssets,
      createdAssets,
      withChanges: lines.filter((line) => line.changes.length > 0).length,
      missingAssets: count.status === "CLOSED" ? missingAssets.length : null,
    },
    lines,
    missingAssets,
  };
}

// Datos de etiqueta SOLO de los activos que creo esta toma (los vinculados ya
// tenian su etiqueta). Mismo formato que las etiquetas de activos existentes.
export async function getCreatedAssetLabelData(
  countId: number,
): Promise<{ tag: string; serialNumber: string | null; productName: string | null }[]> {
  await getInventoryCountByIdOrThrow(countId);
  const created = await InventoryCountLineModel.findAll({
    where: { inventoryCountId: countId, assetCreated: true },
    attributes: ["assetId"],
    order: [["id", "ASC"]],
  });
  if (created.length === 0) return [];
  const labelData = await getAssetsLabelData(created.map((line) => line.assetId));
  return labelData.sort((a, b) => a.tag.localeCompare(b.tag));
}
