import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { ACCOUNTING_TAG_LIKE, isAccountingTag } from "../../library/assetTag";
import { BadRequestError, ConflictError, NotFoundError } from "../../library/errors";
import {
  addMonths,
  buildSchedule,
  currentPeriod,
  isValidPeriod,
  monthsBetween,
  type DepreciationMethod,
  type ScheduleRow,
} from "../../library/depreciation";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { getAssetByIdOrThrow, lockAssetRow } from "./asset.service";
import { recordAccountingEntry } from "./assetKardex.service";
import { getClassOrThrow, getPolicy } from "./assetAccountingPolicy.service";
import { ACCUMULATED_SQL, getNextOpenPeriod } from "./assetDepreciation.service";
import { getProductsByIds } from "../mongo/product.service";

// Gestion contable de activos (plan 007, ciclo ITIL):
//   pendiente -> CLASSIFIED -> COSTED -> CAPITALIZED -> DEPRECIATING -> FULLY_DEPRECIATED
// EXPENSE / INVENTORY quedan en CLASSIFIED (no se capitalizan ni deprecian).
// Cada paso lo audita (*_by / *_at). El valor libro es el saldo del Kardex:
// capitalizar escribe CAPITALIZATION por los costos atribuibles; la
// depreciacion la escribe el cierre mensual (assetDepreciation.service.ts).

export type Classification = "FIXED_ASSET" | "EXPENSE" | "INVENTORY";
export type AccountingStage =
  | "CLASSIFIED"
  | "COSTED"
  | "CAPITALIZED"
  | "DEPRECIATING"
  | "FULLY_DEPRECIATED"
  // Baja contable confirmada (plan 008, assetWriteOff.service.ts): etapa final, valor libro 0.
  | "WRITTEN_OFF";

// Un activo dado de baja (o devaluado despues de la baja: valor 0, Kardex en
// cero) no entra al ciclo contable. Mismo criterio que el cierre de depreciacion.
// Plan 018: tampoco uno devuelto a su proveedor.
const EXCLUDED_STATUS_CODES = ["DECOMMISSIONED", "WRITTEN_OFF", "DEVALUATED", "RETURNED_TO_SUPPLIER"];
// Etapas en que todavia se puede reclasificar o tocar el costo.
const EDITABLE_STAGES: AccountingStage[] = ["CLASSIFIED", "COSTED"];

export interface PendingAsset {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  value: string | null;
  statusName: string;
  costCenterName: string | null;
  productName: string | null;
}

export interface AccountingRecord extends PendingAsset {
  classification: Classification;
  classId: number | null;
  className: string | null;
  stage: AccountingStage;
  acquisitionCost: string | null;
  capitalizedCost: string | null;
  attributableTotal: string;
  usefulLifeMonths: number | null;
  depreciationMethod: DepreciationMethod | null;
  residualValue: string | null;
  depreciationStartPeriod: string | null;
  accumulatedDepreciation: string;
  bookValue: string | null;
  classifiedAt: Date | null;
  costedAt: Date | null;
  capitalizedAt: Date | null;
}

export interface AttributableCost {
  id: number;
  concept: string;
  amount: string;
  documentRef: string | null;
  createdBy: number | null;
  createdAt: Date;
}

type RawRecord = Omit<AccountingRecord, "productName" | "bookValue"> & { productId: string | null };
type RawPending = Omit<PendingAsset, "productName"> & { productId: string | null };

const ASSET_COLUMNS = `
  a.id AS "assetId", a.tag, a.serial_number AS "serialNumber", a.value::text AS value,
  s.name AS "statusName", cc.name AS "costCenterName", a.product_id AS "productId"
`;

const RECORD_SELECT = `
  SELECT ${ASSET_COLUMNS},
         aa.classification, aa.class_id AS "classId", c.name AS "className", aa.stage,
         aa.acquisition_cost::text AS "acquisitionCost", aa.capitalized_cost::text AS "capitalizedCost",
         COALESCE((SELECT SUM(x.amount) FROM asset_attributable_costs x WHERE x.asset_id = aa.asset_id), 0)::text
           AS "attributableTotal",
         aa.useful_life_months AS "usefulLifeMonths", aa.depreciation_method AS "depreciationMethod",
         aa.residual_value::text AS "residualValue",
         to_char(aa.depreciation_start_date, 'YYYY-MM') AS "depreciationStartPeriod",
         ${ACCUMULATED_SQL}::text AS "accumulatedDepreciation",
         aa.classified_at AS "classifiedAt", aa.costed_at AS "costedAt", aa.capitalized_at AS "capitalizedAt"
    FROM asset_accounting aa
    JOIN assets a ON a.id = aa.asset_id
    JOIN asset_statuses s ON s.id = a.status_id
    LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
    LEFT JOIN asset_accounting_classes c ON c.id = aa.class_id
`;

export async function withProductNames<T extends { productId: string | null }>(
  rows: T[],
): Promise<(Omit<T, "productId"> & { productName: string | null })[]> {
  const ids = [...new Set(rows.map((row) => row.productId).filter((id): id is string => !!id))];
  const products = ids.length > 0 ? await getProductsByIds(ids) : [];
  const names = new Map(products.map((product) => [String(product._id), product.name]));
  return rows.map(({ productId, ...rest }) => ({ ...rest, productName: productId ? (names.get(productId) ?? null) : null }));
}

function withBookValue(record: Omit<AccountingRecord, "bookValue">): AccountingRecord {
  if (record.stage === "WRITTEN_OFF") return { ...record, bookValue: "0.00" };
  const bookValue =
    record.capitalizedCost !== null && ["CAPITALIZED", "DEPRECIATING", "FULLY_DEPRECIATED"].includes(record.stage)
      ? (Math.round((Number(record.capitalizedCost) - Number(record.accumulatedDepreciation)) * 100) / 100).toFixed(2)
      : null;
  return { ...record, bookValue };
}

function searchClause(search: string | undefined): { sql: string; replacements: Record<string, string> } {
  if (!search) return { sql: "", replacements: {} };
  return { sql: " AND (a.tag ILIKE :search OR a.serial_number ILIKE :search)", replacements: { search: `%${search}%` } };
}

// Activos sin clasificar (sin fila en asset_accounting), sin los dados de baja.
export async function listPending(params: PaginationParams): Promise<{ items: PendingAsset[]; total: number }> {
  const search = searchClause(params.search);
  const from = `
    FROM assets a
    JOIN asset_statuses s ON s.id = a.status_id
    LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
    LEFT JOIN asset_accounting aa ON aa.asset_id = a.id
   WHERE aa.asset_id IS NULL AND s.code NOT IN (:excluded) AND a.tag LIKE :accountingTag${search.sql}`;
  const replacements = { excluded: EXCLUDED_STATUS_CODES, accountingTag: ACCOUNTING_TAG_LIKE, ...search.replacements };
  const [countRow] = await postgres.query<{ total: number }>(`SELECT COUNT(*)::int AS total ${from}`, {
    replacements,
    type: QueryTypes.SELECT,
  });
  const rows = await postgres.query<RawPending>(
    `SELECT ${ASSET_COLUMNS} ${from} ORDER BY a.id LIMIT :limit OFFSET :offset`,
    { replacements: { ...replacements, limit: params.limit, offset: getOffset(params) }, type: QueryTypes.SELECT },
  );
  return { items: await withProductNames(rows), total: countRow?.total ?? 0 };
}

export async function listRecords(
  params: PaginationParams,
  filters: { stages?: AccountingStage[]; classification?: Classification },
): Promise<{ items: AccountingRecord[]; total: number }> {
  const search = searchClause(params.search);
  let where = "WHERE true";
  const replacements: Record<string, unknown> = { ...search.replacements };
  if (filters.stages?.length) {
    where += " AND aa.stage IN (:stages)";
    replacements.stages = filters.stages;
  }
  if (filters.classification) {
    where += " AND aa.classification = :classification";
    replacements.classification = filters.classification;
  }
  where += search.sql;
  const [countRow] = await postgres.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM asset_accounting aa JOIN assets a ON a.id = aa.asset_id ${where}`,
    { replacements, type: QueryTypes.SELECT },
  );
  const rows = await postgres.query<RawRecord>(`${RECORD_SELECT} ${where} ORDER BY a.id LIMIT :limit OFFSET :offset`, {
    replacements: { ...replacements, limit: params.limit, offset: getOffset(params) },
    type: QueryTypes.SELECT,
  });
  return { items: (await withProductNames(rows)).map(withBookValue), total: countRow?.total ?? 0 };
}

async function findRecord(assetId: number, transaction?: Transaction): Promise<AccountingRecord | null> {
  const rows = await postgres.query<RawRecord>(`${RECORD_SELECT} WHERE aa.asset_id = :assetId`, {
    replacements: { assetId },
    type: QueryTypes.SELECT,
    transaction,
  });
  const [record] = await withProductNames(rows);
  return record ? withBookValue(record) : null;
}

export async function getRecordOrThrow(assetId: number, transaction?: Transaction): Promise<AccountingRecord> {
  const record = await findRecord(assetId, transaction);
  if (!record) throw new NotFoundError(`El activo ${assetId} todavia no tiene clasificacion contable`);
  return record;
}

// Costo, capitalizacion y parametros: nunca sobre un activo dado de baja (su
// Kardex ya quedo en cero; capitalizarlo le devolveria valor). Auditoria de
// seguridad run-2, F2.
async function lockRecord(assetId: number, transaction: Transaction): Promise<AccountingRecord> {
  await lockAssetRow(assetId, transaction);
  const asset = await getAssetByIdOrThrow(assetId, transaction);
  if (EXCLUDED_STATUS_CODES.includes(asset.status?.code ?? "")) {
    throw new ConflictError(`El activo ${asset.tag} esta dado de baja: su registro contable no se modifica`);
  }
  // Plan 018 (revision M1): un arriendo/servicio clasificado antes del plan no avanza de etapa.
  if (!isAccountingTag(asset.tag)) {
    throw new ConflictError(`El activo ${asset.tag} es un arriendo o servicio: no pasa por Contabilidad`);
  }
  return getRecordOrThrow(assetId, transaction);
}

function assertFixedAssetEditable(record: AccountingRecord): void {
  if (record.classification !== "FIXED_ASSET") {
    throw new ConflictError(`El activo ${record.tag} no esta clasificado como activo fijo`);
  }
  if (!EDITABLE_STAGES.includes(record.stage)) {
    throw new ConflictError(`El activo ${record.tag} ya esta capitalizado: su costo no se modifica`);
  }
}

// ---------------------------------------------------------------------------
// 1. Clasificacion contable
// ---------------------------------------------------------------------------
export async function classify(
  assetId: number,
  input: { classification: Classification; classId?: number; belowThresholdConfirmed?: boolean },
  userId: number,
): Promise<AccountingRecord> {
  return postgres.transaction(async (transaction) => {
    await lockAssetRow(assetId, transaction);
    const asset = await getAssetByIdOrThrow(assetId, transaction);
    if (EXCLUDED_STATUS_CODES.includes(asset.status?.code ?? "")) {
      throw new ConflictError(`El activo ${asset.tag} esta dado de baja y no se clasifica`);
    }
    // Plan 018: arriendos y servicios no pasan por Contabilidad.
    if (!isAccountingTag(asset.tag)) {
      throw new ConflictError(`El activo ${asset.tag} es un arriendo o servicio: no se clasifica contablemente`);
    }
    const existing = await findRecord(assetId, transaction);
    if (existing && !EDITABLE_STAGES.includes(existing.stage)) {
      throw new ConflictError(`El activo ${asset.tag} ya esta capitalizado: no se puede reclasificar`);
    }
    if (existing && input.classification !== "FIXED_ASSET" && Number(existing.attributableTotal) > 0) {
      throw new ConflictError(
        `El activo ${asset.tag} tiene costos atribuibles registrados: quitelos antes de clasificarlo como gasto o inventario`,
      );
    }

    let classId: number | null = null;
    if (input.classification === "FIXED_ASSET") {
      if (!input.classId) throw new BadRequestError("Un activo fijo requiere su clase contable");
      const accountingClass = await getClassOrThrow(input.classId, transaction);
      if (!accountingClass.isActive) throw new BadRequestError(`La clase ${accountingClass.name} esta inactiva`);
      classId = accountingClass.id;

      const { capitalizationThreshold } = await getPolicy(transaction);
      const threshold = Number(capitalizationThreshold);
      if (threshold > 0 && asset.value !== null && Number(asset.value) < threshold && !input.belowThresholdConfirmed) {
        throw new ConflictError(
          `El valor del activo (${asset.value}) esta bajo el umbral de capitalizacion (${capitalizationThreshold}): ` +
            "la politica sugiere clasificarlo como gasto. Confirme para clasificarlo igual como activo fijo.",
          { belowThreshold: true, threshold: capitalizationThreshold, value: asset.value },
        );
      }
    }

    // Reclasificar vuelve a CLASSIFIED y limpia lo calculado al fijar el costo.
    await postgres.query(
      `INSERT INTO asset_accounting (asset_id, classification, class_id, stage, classified_by, classified_at, updated_at)
       VALUES (:assetId, :classification, :classId, 'CLASSIFIED', :userId, now(), now())
       ON CONFLICT (asset_id) DO UPDATE SET
         classification = EXCLUDED.classification, class_id = EXCLUDED.class_id, stage = 'CLASSIFIED',
         acquisition_cost = NULL, capitalized_cost = NULL, useful_life_months = NULL,
         depreciation_method = NULL, residual_value = NULL, depreciation_start_date = NULL,
         costed_by = NULL, costed_at = NULL,
         classified_by = EXCLUDED.classified_by, classified_at = now(), updated_at = now()`,
      { replacements: { assetId, classification: input.classification, classId, userId }, transaction },
    );
    return getRecordOrThrow(assetId, transaction);
  });
}

// ---------------------------------------------------------------------------
// 2. Determinar costo (adquisicion + costos directamente atribuibles)
// ---------------------------------------------------------------------------
export async function listCosts(assetId: number): Promise<AttributableCost[]> {
  await getRecordOrThrow(assetId);
  return postgres.query<AttributableCost>(
    `SELECT id, concept, amount::text AS amount, document_ref AS "documentRef", created_by AS "createdBy",
            created_at AS "createdAt"
       FROM asset_attributable_costs WHERE asset_id = :assetId ORDER BY id`,
    { replacements: { assetId }, type: QueryTypes.SELECT },
  );
}

// Tocar un costo invalida el costo ya fijado: vuelve a CLASSIFIED y hay que
// confirmarlo de nuevo.
async function resetToClassified(assetId: number, transaction: Transaction): Promise<void> {
  await postgres.query(
    `UPDATE asset_accounting
        SET stage = 'CLASSIFIED', acquisition_cost = NULL, capitalized_cost = NULL,
            costed_by = NULL, costed_at = NULL, updated_at = now()
      WHERE asset_id = :assetId`,
    { replacements: { assetId }, transaction },
  );
}

export async function addCost(
  assetId: number,
  input: { concept: string; amount: number; documentRef?: string },
  userId: number,
): Promise<AttributableCost[]> {
  await postgres.transaction(async (transaction) => {
    const record = await lockRecord(assetId, transaction);
    assertFixedAssetEditable(record);
    await postgres.query(
      `INSERT INTO asset_attributable_costs (asset_id, concept, amount, document_ref, created_by)
       VALUES (:assetId, :concept, :amount, :documentRef, :userId)`,
      {
        replacements: {
          assetId,
          concept: input.concept,
          amount: input.amount.toFixed(2),
          documentRef: input.documentRef ?? null,
          userId,
        },
        transaction,
      },
    );
    await resetToClassified(assetId, transaction);
  });
  return listCosts(assetId);
}

export async function removeCost(assetId: number, costId: number): Promise<void> {
  await postgres.transaction(async (transaction) => {
    const record = await lockRecord(assetId, transaction);
    assertFixedAssetEditable(record);
    const [, affected] = (await postgres.query(
      `DELETE FROM asset_attributable_costs WHERE id = :costId AND asset_id = :assetId`,
      { replacements: { costId, assetId }, transaction },
    )) as [unknown, { rowCount?: number }];
    if (!affected?.rowCount) throw new NotFoundError(`El costo ${costId} no existe para este activo`);
    await resetToClassified(assetId, transaction);
  });
}

export async function confirmCost(assetId: number, userId: number): Promise<AccountingRecord> {
  return postgres.transaction(async (transaction) => {
    const record = await lockRecord(assetId, transaction);
    assertFixedAssetEditable(record);
    if (record.value === null) {
      throw new BadRequestError(`El activo ${record.tag} no tiene valor de adquisicion: valorícelo primero en «Valorización»`);
    }
    const accountingClass = await getClassOrThrow(record.classId!, transaction);
    const acquisition = Number(record.value);
    const capitalized = Math.round((acquisition + Number(record.attributableTotal)) * 100) / 100;
    const residual = Math.round(capitalized * Number(accountingClass.residualRate) * 100) / 100;
    await postgres.query(
      `UPDATE asset_accounting
          SET stage = 'COSTED', acquisition_cost = :acquisition, capitalized_cost = :capitalized,
              useful_life_months = COALESCE(useful_life_months, :life),
              depreciation_method = COALESCE(depreciation_method, :method),
              residual_value = COALESCE(residual_value, :residual),
              costed_by = :userId, costed_at = now(), updated_at = now()
        WHERE asset_id = :assetId`,
      {
        replacements: {
          assetId,
          acquisition: acquisition.toFixed(2),
          capitalized: capitalized.toFixed(2),
          life: accountingClass.usefulLifeMonths,
          method: accountingClass.defaultMethod,
          residual: residual.toFixed(2),
          userId,
        },
        transaction,
      },
    );
    return getRecordOrThrow(assetId, transaction);
  });
}

// ---------------------------------------------------------------------------
// 3. Capitalizacion
// ---------------------------------------------------------------------------
async function assertStartPeriod(start: string, transaction: Transaction): Promise<void> {
  if (!isValidPeriod(start)) throw new BadRequestError("El inicio de la depreciacion debe tener el formato AAAA-MM");
  const nextOpen = await getNextOpenPeriod(transaction);
  if (nextOpen && monthsBetween(nextOpen, start) < 0) {
    throw new ConflictError(`La depreciacion no puede comenzar en un mes ya cerrado: el primer mes abierto es ${nextOpen}`);
  }
}

export async function capitalize(
  assetId: number,
  input: { depreciationStartPeriod?: string },
  userId: number,
): Promise<AccountingRecord> {
  return postgres.transaction(async (transaction) => {
    const record = await lockRecord(assetId, transaction);
    if (record.classification !== "FIXED_ASSET") {
      throw new ConflictError(`El activo ${record.tag} no esta clasificado como activo fijo`);
    }
    if (record.stage !== "COSTED") {
      throw new ConflictError(
        record.stage === "CLASSIFIED"
          ? `Fije primero el costo del activo ${record.tag} en «Determinar Costo»`
          : `El activo ${record.tag} ya esta capitalizado`,
      );
    }
    // El valor de adquisicion pudo cambiar (ajuste) despues de fijar el costo.
    if (record.value === null || Number(record.value) !== Number(record.acquisitionCost)) {
      throw new ConflictError(`El valor del activo ${record.tag} cambio desde que se fijo el costo: vuelva a fijarlo`);
    }

    const nextOpen = await getNextOpenPeriod(transaction);
    const defaultStart = addMonths(currentPeriod(), 1);
    const start =
      input.depreciationStartPeriod ??
      (nextOpen && monthsBetween(defaultStart, nextOpen) > 0 ? nextOpen : defaultStart);
    await assertStartPeriod(start, transaction);

    const attributable = Number(record.attributableTotal);
    if (attributable > 0) {
      await recordAccountingEntry(
        {
          assetId,
          entryType: "CAPITALIZATION",
          amount: attributable,
          reference: record.tag,
          notes: "Capitalizacion: costos directamente atribuibles",
          createdBy: userId,
        },
        transaction,
      );
    }
    await postgres.query(
      `UPDATE asset_accounting
          SET stage = 'CAPITALIZED', depreciation_start_date = :start,
              capitalized_by = :userId, capitalized_at = now(), updated_at = now()
        WHERE asset_id = :assetId`,
      { replacements: { assetId, start: `${start}-01`, userId }, transaction },
    );
    return getRecordOrThrow(assetId, transaction);
  });
}

// ---------------------------------------------------------------------------
// 4. Parametros de depreciacion y tabla proyectada
// ---------------------------------------------------------------------------
export async function updateDepreciationParams(
  assetId: number,
  input: {
    usefulLifeMonths?: number;
    depreciationMethod?: DepreciationMethod;
    residualValue?: number;
    depreciationStartPeriod?: string;
  },
): Promise<AccountingRecord> {
  return postgres.transaction(async (transaction) => {
    const record = await lockRecord(assetId, transaction);
    if (record.classification !== "FIXED_ASSET" || !["COSTED", "CAPITALIZED"].includes(record.stage)) {
      throw new ConflictError(`Los parametros de depreciacion del activo ${record.tag} ya no se pueden modificar`);
    }
    if (Number(record.accumulatedDepreciation) > 0) {
      throw new ConflictError(`El activo ${record.tag} ya tiene depreciacion registrada: sus parametros quedan fijos`);
    }
    if (input.residualValue !== undefined && Number(input.residualValue) >= Number(record.capitalizedCost)) {
      throw new BadRequestError("El valor residual debe ser menor que el costo capitalizado");
    }
    if (input.depreciationStartPeriod !== undefined) {
      if (record.stage !== "CAPITALIZED") {
        throw new BadRequestError("El inicio de la depreciacion se fija al capitalizar");
      }
      await assertStartPeriod(input.depreciationStartPeriod, transaction);
    }
    await postgres.query(
      `UPDATE asset_accounting
          SET useful_life_months = COALESCE(:life, useful_life_months),
              depreciation_method = COALESCE(:method, depreciation_method),
              residual_value = COALESCE(:residual, residual_value),
              depreciation_start_date = COALESCE(:start, depreciation_start_date),
              updated_at = now()
        WHERE asset_id = :assetId`,
      {
        replacements: {
          assetId,
          life: input.usefulLifeMonths ?? null,
          method: input.depreciationMethod ?? null,
          residual: input.residualValue !== undefined ? input.residualValue.toFixed(2) : null,
          start: input.depreciationStartPeriod ? `${input.depreciationStartPeriod}-01` : null,
        },
        transaction,
      },
    );
    return getRecordOrThrow(assetId, transaction);
  });
}

export async function getSchedule(assetId: number): Promise<{ record: AccountingRecord; rows: ScheduleRow[] }> {
  const record = await getRecordOrThrow(assetId);
  if (
    record.capitalizedCost === null ||
    record.usefulLifeMonths === null ||
    record.depreciationMethod === null ||
    record.residualValue === null
  ) {
    return { record, rows: [] };
  }
  const start = record.depreciationStartPeriod ?? addMonths(currentPeriod(), 1);
  const rows = buildSchedule(
    {
      cost: Number(record.capitalizedCost),
      residual: Number(record.residualValue),
      lifeMonths: record.usefulLifeMonths,
      method: record.depreciationMethod,
    },
    start,
  );
  return { record, rows };
}
