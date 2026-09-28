import { QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { postgres } from "../../databases/postgres/connection";
import { BadRequestError, ConflictError } from "../../library/errors";
import { createPerson } from "../mssql/person.service";
import { createUser } from "../mssql/user.service";
import { getRoleByName } from "./role.service";
import { createCostCenter } from "./costCenter.service";
import { createProduct } from "../mongo/product.service";
import { createAssetsFromReceipt, getAssetByIdOrThrow } from "./asset.service";
import { updatePolicy } from "./assetAccountingPolicy.service";
import { classify } from "./assetAccounting.service";
import { listEligible } from "./assetWriteOff.service";
import { assignAssetToUser, createAssetMovement, decommissionAsset, getDecommissionCheck } from "./assetMovement.service";

// Plan 012: Dar de Baja Activos.
const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: [
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
});

async function createAvailableAsset() {
  const costCenter = await createCostCenter({ code: 69000 + ++seq, name: "Centro baja operativa" });
  const product = await createProduct({ name: `Producto baja operativa ${++seq}`, productType: "COMPRA" });
  const [asset] = await createAssetsFromReceipt({
    goodsReceiptId: 992000 + ++seq,
    productId: String(product._id),
    quantity: 1,
    costCenterId: costCenter.id,
    serialNumbers: [`SN-DC-${seq}`],
    value: "300.00",
    finalStatusCode: "AVAILABLE",
  });
  if (!asset) throw new Error("No se creo el activo de prueba");
  return asset;
}

async function createEmployee() {
  const userRole = await getRoleByName("user");
  if (!userRole) throw new Error('Falta el rol "user" sembrado');
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `Baja${id}`,
    documentId: `TESTDOC-DC${id}`,
    email: `test-dc-${id}@example.com`,
  });
  return createUser({ personId: person.id, roleId: userRole.id, username: `testdc${id}` });
}

async function lastKardexEntry(assetId: number) {
  const [row] = await postgres.query<{ entry_type: string; notes: string | null; balance: string }>(
    "SELECT entry_type, notes, balance FROM asset_kardex_entries WHERE asset_id = :assetId ORDER BY id DESC LIMIT 1",
    { replacements: { assetId }, type: QueryTypes.SELECT },
  );
  return row;
}

describe("Dar de Baja Activos (plan 012, integracion)", () => {
  it("un activo devuelto y clasificado queda de baja, con el motivo en el Kardex, y pasa a Baja Contable", async () => {
    const asset = await createAvailableAsset();
    await classify(asset.id, { classification: "EXPENSE" }, USER_ID);
    const holder = await createEmployee();
    await assignAssetToUser({ assetId: asset.id, userId: holder.id });
    await createAssetMovement({ assetId: asset.id, movementType: "MOVE_TO_RETURNED" });
    await createAssetMovement({ assetId: asset.id, movementType: "RETURNED" });

    const check = await getDecommissionCheck(asset.id);
    expect(check.eligible).toBe(true);
    expect(check.classified).toBe(true);

    const movement = await decommissionAsset({ assetId: asset.id, reason: "OBSOLESCENCE", detail: "Equipo sin soporte", createdBy: USER_ID });
    expect(movement.movementType).toBe("DECOMMISSIONED");
    expect(movement.notes).toBe("Baja: Obsolescencia. Equipo sin soporte");
    expect((await getAssetByIdOrThrow(asset.id)).status?.code).toBe("DECOMMISSIONED");
    const kardex = await lastKardexEntry(asset.id);
    expect(kardex?.entry_type).toBe("WRITE_OFF");
    expect(kardex?.notes).toContain("Obsolescencia");
    expect(Number(kardex?.balance)).toBe(0);

    const eligible = await listEligible(PARAMS);
    expect(eligible.items.map((item) => item.assetId)).toContain(asset.id);
  });

  it("sin clasificacion contable no se da de baja", async () => {
    const asset = await createAvailableAsset();

    const check = await getDecommissionCheck(asset.id);
    expect(check.eligible).toBe(false);
    expect(check.blockReason).toContain("Clasificacion Contable");

    await expect(decommissionAsset({ assetId: asset.id, reason: "OBSOLESCENCE" })).rejects.toBeInstanceOf(ConflictError);
    expect((await getAssetByIdOrThrow(asset.id)).status?.code).toBe("AVAILABLE");
  });

  it("un activo asignado primero se devuelve", async () => {
    const asset = await createAvailableAsset();
    await classify(asset.id, { classification: "EXPENSE" }, USER_ID);
    await assignAssetToUser({ assetId: asset.id, userId: (await createEmployee()).id });

    const check = await getDecommissionCheck(asset.id);
    expect(check.eligible).toBe(false);
    expect(check.blockReason).toContain("Devoluciones de Activos");
    await expect(decommissionAsset({ assetId: asset.id, reason: "THEFT_LOSS" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("motivo Otro exige detalle", async () => {
    const asset = await createAvailableAsset();
    await classify(asset.id, { classification: "EXPENSE" }, USER_ID);
    await expect(decommissionAsset({ assetId: asset.id, reason: "OTHER", detail: "  " })).rejects.toBeInstanceOf(BadRequestError);
    const movement = await decommissionAsset({ assetId: asset.id, reason: "OTHER", detail: "Donado" });
    expect(movement.notes).toBe("Baja: Otro. Donado");
  });
});
