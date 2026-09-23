import { QueryTypes, Transaction } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetKardexEntryModel } from "../../models/postgres/assetKardexEntry.model";
import { getAssetByIdOrThrow } from "./asset.service";
import { BadRequestError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder } from "../../library/sequelizeSearch";
import type {
  CreateManualKardexEntryInput,
  ProductKardexBalance,
  RecordAcquisitionInput,
  RecordWriteOffInput,
} from "../../types/postgres/assetKardexEntry.types";

// Bloquea la fila del activo (FOR UPDATE) antes de leer el ultimo balance
// escrito para el -serializa las escrituras de kardex de ESE activo entre
// las 3 replicas de la API, sin necesitar un contador aparte que pueda
// desincronizarse del ledger real (a diferencia de asset_tag_counters, que
// no tiene un "valor derivable" con el que contrastarse). Debe llamarse
// SIEMPRE dentro de la misma transaccion que el INSERT del asiento nuevo, y
// UNA SOLA VEZ por asiento (el lock se libera recien al terminar la
// transaccion, un segundo llamado dentro de la misma tx no aporta nada).
async function lockAndGetPreviousBalance(assetId: number, transaction: Transaction): Promise<number> {
  await postgres.query(`SELECT id FROM assets WHERE id = :assetId FOR UPDATE`, {
    replacements: { assetId },
    transaction,
  });
  const last = await AssetKardexEntryModel.findOne({
    where: { assetId },
    order: [["id", "DESC"]],
    transaction,
  });
  return last ? Number(last.balance) : 0;
}

export async function listEntriesByAsset(
  assetId: number,
  params: PaginationParams,
): Promise<{ items: AssetKardexEntryModel[]; total: number }> {
  const { rows, count } = await AssetKardexEntryModel.findAndCountAll({
    where: { assetId },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

// Agregado DERIVADO sobre el mismo ledger (SUM(amount) GROUP BY product_id),
// no un saldo guardado en una segunda tabla -evita que un saldo por producto
// pueda divergir del historial real de asientos. Solo suma activos con
// product_id resuelto (los creados antes de esta fase quedan afuera).
export async function listBalanceByProduct(): Promise<ProductKardexBalance[]> {
  return postgres.query<ProductKardexBalance>(
    `SELECT product_id AS "productId", SUM(amount)::numeric(18,2)::text AS balance, COUNT(*)::int AS "entryCount"
     FROM asset_kardex_entries
     WHERE product_id IS NOT NULL
     GROUP BY product_id
     ORDER BY product_id`,
    { type: QueryTypes.SELECT },
  );
}

// Alta por recepcion (ver createAssetsFromReceipt en asset.service.ts):
// SIEMPRE se llama dentro de la misma transaccion que crea el Asset -si esto
// falla, toda la recepcion de esa unidad se revierte junto con ella, no
// puede quedar un Asset sin su asiento de alta.
export async function recordAcquisition(
  input: RecordAcquisitionInput,
  transaction: Transaction,
): Promise<AssetKardexEntryModel> {
  const asset = await getAssetByIdOrThrow(input.assetId, transaction);
  const previousBalance = await lockAndGetPreviousBalance(input.assetId, transaction);
  const unitCost = Number(input.unitCost).toFixed(2);
  const balance = (previousBalance + Number(unitCost)).toFixed(2);
  return AssetKardexEntryModel.create(
    {
      assetId: input.assetId,
      productId: asset.productId,
      entryType: "ACQUISITION",
      entryDate: new Date(),
      unitCost,
      amount: unitCost,
      balance,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    },
    { transaction },
  );
}

// Baja (ver createAssetMovement en assetMovement.service.ts, movementType
// DECOMMISSIONED): lleva el saldo del activo a 0 sin importar cual sea hoy,
// en vez de pedirle el monto a quien dispara la baja -evita que alguien
// pueda "olvidar" descargar el valor completo por error.
export async function recordWriteOff(
  input: RecordWriteOffInput,
  transaction: Transaction,
): Promise<AssetKardexEntryModel> {
  const asset = await getAssetByIdOrThrow(input.assetId, transaction);
  const previousBalance = await lockAndGetPreviousBalance(input.assetId, transaction);
  const amount = (-previousBalance).toFixed(2);
  const balance = "0.00";
  return AssetKardexEntryModel.create(
    {
      assetId: input.assetId,
      productId: asset.productId,
      entryType: "WRITE_OFF",
      entryDate: new Date(),
      unitCost: previousBalance.toFixed(2),
      amount,
      balance,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    },
    { transaction },
  );
}

// Asiento manual (admin-only, POST /asset-kardex): unica via para corregir
// un error del ledger -nunca se edita/borra un renglon existente (ver
// comentario largo en migrate.ts). ADJUSTMENT usa el "amount" que mande el
// cliente (con signo: positivo revaloriza, negativo castiga valor);
// WRITE_OFF ignora "amount" y siempre lleva el saldo a 0, mismo criterio que
// recordWriteOff.
export async function createManualEntry(input: CreateManualKardexEntryInput): Promise<AssetKardexEntryModel> {
  await getAssetByIdOrThrow(input.assetId);

  return postgres.transaction(async (transaction) => {
    if (input.entryType === "WRITE_OFF") {
      return recordWriteOff(
        { assetId: input.assetId, reference: input.reference, notes: input.notes, createdBy: input.createdBy },
        transaction,
      );
    }

    if (input.amount === undefined) {
      throw new BadRequestError("Un ajuste manual requiere indicar 'amount'");
    }
    const asset = await getAssetByIdOrThrow(input.assetId, transaction);
    const previousBalance = await lockAndGetPreviousBalance(input.assetId, transaction);
    const amount = Number(input.amount).toFixed(2);
    const balance = (previousBalance + Number(amount)).toFixed(2);
    return AssetKardexEntryModel.create(
      {
        assetId: input.assetId,
        productId: asset.productId,
        entryType: "ADJUSTMENT",
        entryDate: new Date(),
        unitCost: Number(input.amount).toFixed(2),
        amount,
        balance,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
      },
      { transaction },
    );
  });
}

// Asientos de la gestion contable (plan 007): CAPITALIZATION suma los costos
// atribuibles al capitalizar, DEPRECIATION resta la cuota de un cierre mensual
// y DEPRECIATION_REVERSAL la devuelve al anular el ultimo cierre. "amount" va
// con signo; el saldo se calcula bajo el mismo lock que el resto de los
// asientos. SIEMPRE dentro de la transaccion de la operacion que lo origina.
export async function recordAccountingEntry(
  input: {
    assetId: number;
    entryType: "CAPITALIZATION" | "DEPRECIATION" | "DEPRECIATION_REVERSAL";
    amount: number;
    reference?: string | null;
    notes?: string | null;
    createdBy?: number | null;
  },
  transaction: Transaction,
): Promise<AssetKardexEntryModel> {
  const asset = await getAssetByIdOrThrow(input.assetId, transaction);
  const previousBalance = await lockAndGetPreviousBalance(input.assetId, transaction);
  const amount = input.amount.toFixed(2);
  const balance = (previousBalance + Number(amount)).toFixed(2);
  return AssetKardexEntryModel.create(
    {
      assetId: input.assetId,
      productId: asset.productId,
      entryType: input.entryType,
      entryDate: new Date(),
      unitCost: Math.abs(input.amount).toFixed(2),
      amount,
      balance,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    },
    { transaction },
  );
}
