import { QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { postgres } from "../../databases/postgres/connection";
import { AssetKardexEntryModel } from "../../models/postgres/assetKardexEntry.model";
import { BadRequestError, ConflictError } from "../../library/errors";
import { addMonths, currentPeriod } from "../../library/depreciation";
import { createCostCenter } from "./costCenter.service";
import { createProduct } from "../mongo/product.service";
import { createAssetsFromReceipt } from "./asset.service";
import { createAssetMovement } from "./assetMovement.service";
import { updatePolicy } from "./assetAccountingPolicy.service";
import {
  addCost,
  capitalize,
  classify,
  confirmCost,
  getRecordOrThrow,
  listPending,
  updateDepreciationParams,
} from "./assetAccounting.service";
import { closePeriod, previewNextClose, voidRun } from "./assetDepreciation.service";

const RESET_TABLES = {
  postgres: [
    "asset_depreciation_entries",
    "asset_depreciation_runs",
    "asset_attributable_costs",
    "asset_accounting",
    "asset_movement_users",
    "asset_movements",
    "asset_kardex_entries",
    "assets",
    "cost_centers",
  ],
  mongo: ["Product"],
};

const USER_ID = 1;
const PARAMS = { page: 1, limit: 50, sortBy: "id", sortOrder: "asc" } as const;
let seq = 0;

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
  await updatePolicy(0, USER_ID);
});

afterEach(async () => {
  await resetTestData(RESET_TABLES);
  await updatePolicy(0, USER_ID);
});

async function createAssets(quantity: number, value: string | null) {
  const costCenter = await createCostCenter({ code: 66000 + ++seq, name: "Centro contable" });
  const product = await createProduct({ name: `Producto contable ${++seq}`, productType: "COMPRA" });
  return createAssetsFromReceipt({
    goodsReceiptId: 990000 + ++seq,
    productId: String(product._id),
    quantity,
    costCenterId: costCenter.id,
    serialNumbers: Array.from({ length: quantity }, (_, i) => `SN-ACC-${seq}-${i}`),
    value,
    finalStatusCode: "AVAILABLE",
  });
}

async function computerClassId(): Promise<number> {
  const [row] = await postgres.query<{ id: number }>(
    `SELECT id FROM asset_accounting_classes WHERE code = 'COMPUTER-EQUIPMENT'`,
    { type: QueryTypes.SELECT },
  );
  if (!row) throw new Error("Falta la clase COMPUTER-EQUIPMENT sembrada");
  return row.id;
}

async function kardexBalance(assetId: number): Promise<number> {
  const last = await AssetKardexEntryModel.findOne({ where: { assetId }, order: [["id", "DESC"]] });
  return Number(last?.balance ?? 0);
}

// Activo fijo capitalizado con depreciacion lineal de lifeMonths meses desde startPeriod.
async function capitalizedAsset(value: string, lifeMonths: number, startPeriod: string, extraCost = 0) {
  const [asset] = await createAssets(1, value);
  await classify(asset!.id, { classification: "FIXED_ASSET", classId: await computerClassId() }, USER_ID);
  if (extraCost > 0) await addCost(asset!.id, { concept: "Instalacion", amount: extraCost }, USER_ID);
  await confirmCost(asset!.id, USER_ID);
  await updateDepreciationParams(asset!.id, { usefulLifeMonths: lifeMonths, depreciationMethod: "LINEAR", residualValue: 0 });
  await capitalize(asset!.id, { depreciationStartPeriod: startPeriod }, USER_ID);
  return asset!;
}

describe("gestion contable de activos", () => {
  it("lista pendientes sin los dados de baja y exige clase para un activo fijo", async () => {
    const [pending, decommissioned] = await createAssets(2, "1000.00");
    await createAssetMovement({ assetId: decommissioned!.id, movementType: "DECOMMISSIONED" });

    const { items } = await listPending({ ...PARAMS });
    expect(items.map((item) => item.assetId)).toEqual([pending!.id]);

    await expect(classify(pending!.id, { classification: "FIXED_ASSET" }, USER_ID)).rejects.toBeInstanceOf(BadRequestError);
    await classify(pending!.id, { classification: "EXPENSE" }, USER_ID);
    expect((await listPending({ ...PARAMS })).total).toBe(0);
    expect(await getRecordOrThrow(pending!.id)).toMatchObject({ classification: "EXPENSE", stage: "CLASSIFIED" });
  });

  it("bajo el umbral exige confirmacion para clasificar como activo fijo", async () => {
    const [asset] = await createAssets(1, "50000.00");
    await updatePolicy(100000, USER_ID);
    const classId = await computerClassId();

    await expect(classify(asset!.id, { classification: "FIXED_ASSET", classId }, USER_ID)).rejects.toBeInstanceOf(
      ConflictError,
    );
    const record = await classify(
      asset!.id,
      { classification: "FIXED_ASSET", classId, belowThresholdConfirmed: true },
      USER_ID,
    );
    expect(record.stage).toBe("CLASSIFIED");
  });

  it("el costo exige valor de adquisicion y suma los atribuibles; capitalizar los escribe en el Kardex", async () => {
    const [withoutValue] = await createAssets(1, null);
    const classId = await computerClassId();
    await classify(withoutValue!.id, { classification: "FIXED_ASSET", classId }, USER_ID);
    await expect(confirmCost(withoutValue!.id, USER_ID)).rejects.toBeInstanceOf(BadRequestError);

    const [asset] = await createAssets(1, "1000.00");
    await classify(asset!.id, { classification: "FIXED_ASSET", classId }, USER_ID);
    await addCost(asset!.id, { concept: "Flete", amount: 150 }, USER_ID);
    await addCost(asset!.id, { concept: "Instalacion", amount: 50.5 }, USER_ID);
    // Capitalizar antes de fijar el costo no se permite.
    await expect(capitalize(asset!.id, {}, USER_ID)).rejects.toBeInstanceOf(ConflictError);

    const costed = await confirmCost(asset!.id, USER_ID);
    expect(costed).toMatchObject({ stage: "COSTED", acquisitionCost: "1000.00", capitalizedCost: "1200.50" });

    const capitalized = await capitalize(asset!.id, {}, USER_ID);
    expect(capitalized.stage).toBe("CAPITALIZED");
    expect(capitalized.depreciationStartPeriod).toBe(addMonths(currentPeriod(), 1));
    expect(await kardexBalance(asset!.id)).toBe(1200.5);

    // Ya capitalizado: no se reclasifica ni se tocan sus costos.
    await expect(classify(asset!.id, { classification: "EXPENSE" }, USER_ID)).rejects.toBeInstanceOf(ConflictError);
    await expect(addCost(asset!.id, { concept: "Otro", amount: 1 }, USER_ID)).rejects.toBeInstanceOf(ConflictError);
  });

  it("cierre mensual en orden hasta el residual, y solo se anula el ultimo", async () => {
    const asset = await capitalizedAsset("1000.00", 3, "2025-01");

    const preview = await previewNextClose();
    expect(preview).toMatchObject({ period: "2025-01", canClose: true, totalAmount: "333.33" });

    await expect(closePeriod("2025-02", USER_ID)).rejects.toBeInstanceOf(ConflictError);
    const january = await closePeriod("2025-01", USER_ID);
    expect(january).toMatchObject({ period: "2025-01", status: "CLOSED", assetCount: 1, totalAmount: "333.33" });
    expect(await kardexBalance(asset.id)).toBe(666.67);
    expect((await getRecordOrThrow(asset.id)).stage).toBe("DEPRECIATING");

    // Los parametros quedan fijos una vez que hay depreciacion registrada.
    await expect(updateDepreciationParams(asset.id, { usefulLifeMonths: 12 })).rejects.toBeInstanceOf(ConflictError);

    const february = await closePeriod("2025-02", USER_ID);
    await closePeriod("2025-03", USER_ID);
    const record = await getRecordOrThrow(asset.id);
    expect(record).toMatchObject({ stage: "FULLY_DEPRECIATED", accumulatedDepreciation: "1000.00", bookValue: "0.00" });
    expect(await kardexBalance(asset.id)).toBe(0);

    await expect(voidRun(february.id, USER_ID)).rejects.toBeInstanceOf(ConflictError);
    const [march] = await postgres.query<{ id: number }>(
      `SELECT id FROM asset_depreciation_runs WHERE period = '2025-03-01'`,
      { type: QueryTypes.SELECT },
    );
    const voided = await voidRun(march!.id, USER_ID);
    expect(voided.status).toBe("VOIDED");
    expect(await getRecordOrThrow(asset.id)).toMatchObject({ stage: "DEPRECIATING", accumulatedDepreciation: "666.66" });
    expect(await kardexBalance(asset.id)).toBe(333.34);

    // El mes anulado se puede volver a cerrar.
    await closePeriod("2025-03", USER_ID);
    expect(await kardexBalance(asset.id)).toBe(0);
  });

  it("no cierra periodos futuros y dos cierres simultaneos del mismo mes dejan uno solo", async () => {
    await capitalizedAsset("1200.00", 12, "2025-01");
    await expect(closePeriod(addMonths(currentPeriod(), 1), USER_ID)).rejects.toBeInstanceOf(BadRequestError);

    const results = await Promise.allSettled([closePeriod("2025-01", USER_ID), closePeriod("2025-01", USER_ID)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [row] = await postgres.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM asset_depreciation_runs WHERE status = 'CLOSED' AND period = '2025-01-01'`,
      { type: QueryTypes.SELECT },
    );
    expect(row?.count).toBe(1);
  });
});
