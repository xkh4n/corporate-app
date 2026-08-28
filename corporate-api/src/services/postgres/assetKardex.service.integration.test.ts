import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { createProduct } from "../mongo/product.service";
import { createAssetsFromReceipt } from "./asset.service";
import { createAssetMovement } from "./assetMovement.service";
import { createUser } from "../mssql/user.service";
import { createPerson } from "../mssql/person.service";
import { getRoleByName } from "./role.service";
import { createManualEntry, listBalanceByProduct, listEntriesByAsset } from "./assetKardex.service";

let seq = 0;

const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: ["asset_kardex_entries", "asset_movement_users", "asset_movements", "assets"],
  mongo: ["Product"],
};

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  await resetTestData(RESET_TABLES);
});

async function createFixtureProduct() {
  return createProduct({ name: `Producto Kardex${++seq}`, productType: "COMPRA" });
}

async function createFixtureUser() {
  const role = await getRoleByName("user");
  if (!role) throw new Error('Falta el rol "user" sembrado -revisar migratePostgres()');
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `PersonaKX${id}`,
    documentId: `TESTDOC-KX${id}`,
    email: `test-kx-persona-${id}@example.com`,
  });
  return createUser({ personId: person.id, roleId: role.id, username: `testkx${id}` });
}

describe("assetKardex.service (integracion, Postgres real)", () => {
  it("createAssetsFromReceipt escribe un asiento ACQUISITION por unidad con el saldo correcto", async () => {
    const product = await createFixtureProduct();
    const assets = await createAssetsFromReceipt({
      goodsReceiptId: 888_001,
      productId: String(product._id),
      quantity: 2,
      value: "1000.00",
      finalStatusCode: "AVAILABLE",
    });

    for (const asset of assets) {
      const { items } = await listEntriesByAsset(asset.id, { page: 1, limit: 10, sortBy: "id", sortOrder: "asc" });
      expect(items).toHaveLength(1);
      expect(items[0]?.entryType).toBe("ACQUISITION");
      expect(items[0]?.balance).toBe("1000.00");
      expect(items[0]?.productId).toBe(String(product._id));
    }
  });

  it("DECOMMISSIONED escribe un WRITE_OFF que lleva el saldo del activo a 0", async () => {
    const product = await createFixtureProduct();
    const [asset] = await createAssetsFromReceipt({
      goodsReceiptId: 888_002,
      productId: String(product._id),
      quantity: 1,
      value: "500.00",
      finalStatusCode: "AVAILABLE",
    });

    await createAssetMovement({ assetId: asset!.id, movementType: "DECOMMISSIONED" });

    const { items } = await listEntriesByAsset(asset!.id, { page: 1, limit: 10, sortBy: "id", sortOrder: "asc" });
    expect(items).toHaveLength(2);
    expect(items[1]?.entryType).toBe("WRITE_OFF");
    expect(items[1]?.balance).toBe("0.00");
    expect(items[1]?.amount).toBe("-500.00");
  });

  it("ASSIGNED no escribe ningun asiento de kardex -asignar no cambia la valorizacion", async () => {
    const product = await createFixtureProduct();
    const [asset] = await createAssetsFromReceipt({
      goodsReceiptId: 888_003,
      productId: String(product._id),
      quantity: 1,
      value: "500.00",
      finalStatusCode: "AVAILABLE",
    });
    const employee = await createFixtureUser();

    await createAssetMovement({ assetId: asset!.id, movementType: "ASSIGNED", userIds: [employee.id] });

    const { items } = await listEntriesByAsset(asset!.id, { page: 1, limit: 10, sortBy: "id", sortOrder: "asc" });
    expect(items).toHaveLength(1);
    expect(items[0]?.entryType).toBe("ACQUISITION");
  });

  it("createManualEntry ADJUSTMENT suma/resta segun el signo, sin tocar renglones anteriores", async () => {
    const product = await createFixtureProduct();
    const [asset] = await createAssetsFromReceipt({
      goodsReceiptId: 888_004,
      productId: String(product._id),
      quantity: 1,
      value: "1000.00",
      finalStatusCode: "AVAILABLE",
    });

    await createManualEntry({ assetId: asset!.id, entryType: "ADJUSTMENT", amount: "200.00", notes: "Revalorización" });
    await createManualEntry({ assetId: asset!.id, entryType: "ADJUSTMENT", amount: "-50.00", notes: "Depreciación puntual" });

    const { items } = await listEntriesByAsset(asset!.id, { page: 1, limit: 10, sortBy: "id", sortOrder: "asc" });
    expect(items.map((entry) => entry.balance)).toEqual(["1000.00", "1200.00", "1150.00"]);
    // Insert-only: el renglon original de ACQUISITION nunca se modifica.
    expect(items[0]?.amount).toBe("1000.00");
  });

  it("createManualEntry WRITE_OFF lleva el saldo a 0 igual que la baja automatica", async () => {
    const product = await createFixtureProduct();
    const [asset] = await createAssetsFromReceipt({
      goodsReceiptId: 888_005,
      productId: String(product._id),
      quantity: 1,
      value: "300.00",
      finalStatusCode: "AVAILABLE",
    });

    await createManualEntry({ assetId: asset!.id, entryType: "WRITE_OFF", reference: "Robo reportado" });

    const { items } = await listEntriesByAsset(asset!.id, { page: 1, limit: 10, sortBy: "id", sortOrder: "asc" });
    expect(items[items.length - 1]?.balance).toBe("0.00");
  });

  it("listBalanceByProduct agrega el valor de TODAS las unidades del mismo producto", async () => {
    const product = await createFixtureProduct();
    await createAssetsFromReceipt({
      goodsReceiptId: 888_006,
      productId: String(product._id),
      quantity: 3,
      value: "100.00",
      finalStatusCode: "AVAILABLE",
    });

    const balances = await listBalanceByProduct();
    const ours = balances.find((balance) => balance.productId === String(product._id));
    expect(ours?.balance).toBe("300.00");
    expect(ours?.entryCount).toBe(3);
  });

  // Prueba de la decision de diseño central del servicio: lockAndGetPreviousBalance
  // usa SELECT...FOR UPDATE para que 2 escrituras concurrentes sobre el MISMO
  // activo se serialicen en vez de perder una de las dos (lost update).
  it("dos ajustes concurrentes sobre el mismo activo se serializan -ningun 'lost update'", async () => {
    const product = await createFixtureProduct();
    const [asset] = await createAssetsFromReceipt({
      goodsReceiptId: 888_007,
      productId: String(product._id),
      quantity: 1,
      value: "1000.00",
      finalStatusCode: "AVAILABLE",
    });

    await Promise.all([
      createManualEntry({ assetId: asset!.id, entryType: "ADJUSTMENT", amount: "100.00" }),
      createManualEntry({ assetId: asset!.id, entryType: "ADJUSTMENT", amount: "50.00" }),
    ]);

    const { items } = await listEntriesByAsset(asset!.id, { page: 1, limit: 10, sortBy: "id", sortOrder: "asc" });
    expect(items).toHaveLength(3);
    const finalBalance = items[items.length - 1]?.balance;
    expect(finalBalance).toBe("1150.00");
  });
});
