import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { AssetKardexEntryModel } from "../../models/postgres/assetKardexEntry.model";
import { createPerson } from "../mssql/person.service";
import { createUser } from "../mssql/user.service";
import { getRoleByName } from "./role.service";
import { createCostCenter } from "./costCenter.service";
import { createProduct } from "../mongo/product.service";
import { createAssetsFromReceipt, getAssetById } from "./asset.service";
import { createAssetMovement } from "./assetMovement.service";
import { listAssetsPendingValuation, valueAssets, VALUATION_NOTE } from "./assetValuation.service";

let seq = 0;

const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: ["asset_movement_users", "asset_movements", "asset_kardex_entries", "assets", "cost_centers"],
  mongo: ["Product"],
};

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  await resetTestData(RESET_TABLES);
});

async function createFixtureUser() {
  const role = await getRoleByName("user");
  if (!role) throw new Error('Falta el rol "user" sembrado -revisar migratePostgres()');
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `ValIC${id}`,
    documentId: `TESTDOC-VAL${id}`,
    email: `test-val-${id}@example.com`,
  });
  return createUser({ personId: person.id, roleId: role.id, username: `testval${id}` });
}

// Activos SIN valor (como los que crea la toma de inventario): quantity unidades AVAILABLE.
async function createAssetsWithoutValue(quantity: number) {
  const costCenter = await createCostCenter({ code: 55000 + ++seq, name: "Centro valorizacion" });
  const product = await createProduct({ name: `Producto valorizacion ${++seq}`, productType: "COMPRA" });
  return createAssetsFromReceipt({
    goodsReceiptId: 980000 + ++seq,
    productId: String(product._id),
    quantity,
    costCenterId: costCenter.id,
    serialNumbers: Array.from({ length: quantity }, (_, i) => `SN-VAL-${seq}-${i}`),
    finalStatusCode: "AVAILABLE",
  });
}

const PARAMS = { page: 1, limit: 50, sortBy: "id", sortOrder: "asc" } as const;

describe("listAssetsPendingValuation", () => {
  it("lista solo activos sin valor y de estado valorizable", async () => {
    const [pending, valued, decommissioned, devaluated] = await createAssetsWithoutValue(4);
    const user = await createFixtureUser();
    await valueAssets([{ assetId: valued!.id, value: 1000 }], user.id);
    await createAssetMovement({ assetId: decommissioned!.id, movementType: "DECOMMISSIONED" });
    await createAssetMovement({ assetId: devaluated!.id, movementType: "DECOMMISSIONED" });
    await createAssetMovement({ assetId: devaluated!.id, movementType: "DEVALUATED", userIds: [user.id] });

    const { items, total } = await listAssetsPendingValuation({ ...PARAMS });
    expect(total).toBe(1);
    expect(items.map((item) => item.tag)).toEqual([pending!.tag]);
    expect(items[0]).toMatchObject({ status: { code: "AVAILABLE" }, costCenter: { name: "Centro valorizacion" } });
    expect(items[0]!.productName).toContain("Producto valorizacion");
  });

  it("filtra por tag o serie", async () => {
    const [first, second] = await createAssetsWithoutValue(2);
    const { items } = await listAssetsPendingValuation({ ...PARAMS, search: second!.serialNumber! });
    expect(items.map((item) => item.id)).toEqual([second!.id]);
    expect(first).toBeDefined();
  });
});

describe("valueAssets", () => {
  it("fija el valor y escribe el asiento ACQUISITION de alta con el saldo correcto", async () => {
    const [asset] = await createAssetsWithoutValue(1);
    const user = await createFixtureUser();

    const results = await valueAssets([{ assetId: asset!.id, value: 1500.5 }], user.id);
    expect(results).toEqual([{ assetId: asset!.id, ok: true, tag: asset!.tag }]);

    expect(Number((await getAssetById(asset!.id))!.value)).toBe(1500.5);
    const entries = await AssetKardexEntryModel.findAll({ where: { assetId: asset!.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entryType: "ACQUISITION",
      unitCost: "1500.50",
      amount: "1500.50",
      balance: "1500.50",
      reference: asset!.tag,
      notes: VALUATION_NOTE,
      createdBy: user.id,
    });
  });

  it("un activo que ya tiene valor se rechaza y no duplica el asiento", async () => {
    const [asset] = await createAssetsWithoutValue(1);
    const user = await createFixtureUser();
    await valueAssets([{ assetId: asset!.id, value: 100 }], user.id);

    const again = await valueAssets([{ assetId: asset!.id, value: 999 }], user.id);
    expect(again[0]).toMatchObject({ assetId: asset!.id, ok: false });
    expect(again[0]!.error).toContain("ya tiene valor");
    expect(Number((await getAssetById(asset!.id))!.value)).toBe(100);
    expect(await AssetKardexEntryModel.count({ where: { assetId: asset!.id } })).toBe(1);
  });

  it("un fallo no aborta el lote: los demas activos se valorizan", async () => {
    const [first, second] = await createAssetsWithoutValue(2);
    const user = await createFixtureUser();

    const results = await valueAssets(
      [
        { assetId: first!.id, value: 200 },
        { assetId: 987654, value: 300 },
        { assetId: second!.id, value: 400 },
      ],
      user.id,
    );

    expect(results.map((result) => result.ok)).toEqual([true, false, true]);
    expect(Number((await getAssetById(first!.id))!.value)).toBe(200);
    expect(Number((await getAssetById(second!.id))!.value)).toBe(400);
  });

  it("no valoriza activos dados de baja ni devaluados", async () => {
    const [decommissioned] = await createAssetsWithoutValue(1);
    const user = await createFixtureUser();
    await createAssetMovement({ assetId: decommissioned!.id, movementType: "DECOMMISSIONED" });

    const results = await valueAssets([{ assetId: decommissioned!.id, value: 500 }], user.id);
    expect(results[0]).toMatchObject({ ok: false });
    expect((await getAssetById(decommissioned!.id))!.value).toBeNull();
  });
});
