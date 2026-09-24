import fs from "node:fs";
import path from "node:path";
import { QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { postgres } from "../../databases/postgres/connection";
import { BadRequestError, ConflictError } from "../../library/errors";
import { getAssetWriteOffFolder } from "../../library/documentStorage";
import { currentDate } from "../../library/depreciation";
import { createCostCenter } from "./costCenter.service";
import { createProduct } from "../mongo/product.service";
import { createAssetsFromReceipt } from "./asset.service";
import { createAssetMovement } from "./assetMovement.service";
import { updatePolicy } from "./assetAccountingPolicy.service";
import { capitalize, classify, confirmCost, getRecordOrThrow, updateDepreciationParams } from "./assetAccounting.service";
import { closePeriod, voidRun } from "./assetDepreciation.service";
import {
  addPhoto,
  attachCertificate,
  confirmWriteOff,
  createWriteOff,
  discardWriteOff,
  getWriteOffOrThrow,
  listEligible,
  removePhoto,
  updateWriteOff,
} from "./assetWriteOff.service";

const RESET_TABLES = {
  postgres: [
    "asset_write_off_photos",
    "asset_write_off_lines",
    "asset_write_offs",
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
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
let seq = 0;
const createdWriteOffs = new Set<number>();

function fakeFile(mimetype: string, buffer: Buffer): Express.Multer.File {
  return { mimetype, buffer, size: buffer.length } as Express.Multer.File;
}
const photo = () => fakeFile("image/png", PNG);
const certificate = () => fakeFile("application/pdf", Buffer.from("%PDF-1.4 certificado"));

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
  await updatePolicy(0, USER_ID);
});

afterEach(async () => {
  for (const id of createdWriteOffs) fs.rmSync(getAssetWriteOffFolder(id), { recursive: true, force: true });
  createdWriteOffs.clear();
  await resetTestData(RESET_TABLES);
});

async function createAssets(quantity: number, value: string | null) {
  const costCenter = await createCostCenter({ code: 67000 + ++seq, name: "Centro baja" });
  const product = await createProduct({ name: `Producto baja ${++seq}`, productType: "COMPRA" });
  return createAssetsFromReceipt({
    goodsReceiptId: 991000 + ++seq,
    productId: String(product._id),
    quantity,
    costCenterId: costCenter.id,
    serialNumbers: Array.from({ length: quantity }, (_, i) => `SN-WO-${seq}-${i}`),
    value,
    finalStatusCode: "AVAILABLE",
  });
}

async function computerClassId(): Promise<number> {
  const [row] = await postgres.query<{ id: number }>(
    `SELECT id FROM asset_accounting_classes WHERE code = 'COMPUTER-EQUIPMENT'`,
    { type: QueryTypes.SELECT },
  );
  return row!.id;
}

// Activo de gasto dado de baja operativamente: elegible con valor libro 0.
async function decommissionedExpense() {
  const [asset] = await createAssets(1, "300.00");
  await classify(asset!.id, { classification: "EXPENSE" }, USER_ID);
  await createAssetMovement({ assetId: asset!.id, movementType: "DECOMMISSIONED" });
  return asset!;
}

async function draft(assetIds: number[]) {
  const created = await createWriteOff(assetIds, USER_ID);
  createdWriteOffs.add(created.id);
  return created;
}

describe("baja contable de activos", () => {
  it("solo son elegibles los activos clasificados y dados de baja operativamente", async () => {
    const eligible = await decommissionedExpense();
    const [inUse] = await createAssets(1, "100.00");
    await classify(inUse!.id, { classification: "EXPENSE" }, USER_ID);
    const [unclassified] = await createAssets(1, "100.00");
    await createAssetMovement({ assetId: unclassified!.id, movementType: "DECOMMISSIONED" });

    const { items } = await listEligible({ ...PARAMS });
    expect(items.map((item) => item.assetId)).toEqual([eligible.id]);

    await expect(createWriteOff([inUse!.id], USER_ID)).rejects.toBeInstanceOf(ConflictError);
    await expect(createWriteOff([unclassified!.id], USER_ID)).rejects.toBeInstanceOf(ConflictError);
  });

  it("confirmar exige datos, certificado y una foto por activo; deja WRITTEN_OFF con el valor libro", async () => {
    // Activo fijo capitalizado a 3 meses con un cierre: valor libro 666.67.
    const [fixed] = await createAssets(1, "1000.00");
    await classify(fixed!.id, { classification: "FIXED_ASSET", classId: await computerClassId() }, USER_ID);
    await confirmCost(fixed!.id, USER_ID);
    await updateDepreciationParams(fixed!.id, { usefulLifeMonths: 3, depreciationMethod: "LINEAR", residualValue: 0 });
    await capitalize(fixed!.id, { depreciationStartPeriod: "2025-01" }, USER_ID);
    await closePeriod("2025-01", USER_ID);
    await createAssetMovement({ assetId: fixed!.id, movementType: "DECOMMISSIONED" });
    const expense = await decommissionedExpense();

    const writeOff = await draft([fixed!.id, expense.id]);
    await expect(confirmWriteOff(writeOff.id, USER_ID)).rejects.toBeInstanceOf(BadRequestError);

    await updateWriteOff(writeOff.id, { writeOffDate: currentDate(), reason: "Equipos obsoletos", notary: "Notaria X" });
    await expect(confirmWriteOff(writeOff.id, USER_ID)).rejects.toThrow(/certificado/);
    await expect(attachCertificate(writeOff.id, fakeFile("image/png", PNG))).rejects.toBeInstanceOf(BadRequestError);
    await attachCertificate(writeOff.id, certificate());

    await addPhoto(writeOff.id, fixed!.id, photo(), USER_ID);
    await expect(confirmWriteOff(writeOff.id, USER_ID)).rejects.toThrow(/foto/);
    await expect(addPhoto(writeOff.id, expense.id, certificate(), USER_ID)).rejects.toBeInstanceOf(BadRequestError);
    await addPhoto(writeOff.id, expense.id, photo(), USER_ID);

    const confirmed = await confirmWriteOff(writeOff.id, USER_ID);
    expect(confirmed).toMatchObject({ status: "CONFIRMED", assetCount: 2, totalBookValue: "666.67" });
    const fixedLine = confirmed.lines.find((line) => line.assetId === fixed!.id)!;
    expect(fixedLine).toMatchObject({ stage: "DEPRECIATING", bookValue: "666.67" });
    expect(fixedLine.photos).toHaveLength(1);
    expect(confirmed.lines.find((line) => line.assetId === expense.id)).toMatchObject({ stage: "CLASSIFIED", bookValue: "0.00" });

    expect(await getRecordOrThrow(fixed!.id)).toMatchObject({ stage: "WRITTEN_OFF", bookValue: "0.00" });
    expect((await listEligible({ ...PARAMS })).total).toBe(0);
    expect(fs.existsSync(path.join(getAssetWriteOffFolder(writeOff.id), "certificado.pdf"))).toBe(true);

    // Definitiva: no se edita, no se descarta y no se le suben archivos.
    await expect(updateWriteOff(writeOff.id, { reason: "Otro motivo" })).rejects.toBeInstanceOf(ConflictError);
    await expect(discardWriteOff(writeOff.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(addPhoto(writeOff.id, expense.id, photo(), USER_ID)).rejects.toBeInstanceOf(ConflictError);
    await expect(removePhoto(writeOff.id, fixedLine.photos[0]!.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("un activo en dos borradores: el segundo en confirmar recibe 409", async () => {
    const asset = await decommissionedExpense();
    const first = await draft([asset.id]);
    const second = await draft([asset.id]);
    for (const writeOff of [first, second]) {
      await updateWriteOff(writeOff.id, { writeOffDate: currentDate(), reason: "Robo" });
      await attachCertificate(writeOff.id, certificate());
      await addPhoto(writeOff.id, asset.id, photo(), USER_ID);
    }

    const results = await Promise.allSettled([confirmWriteOff(first.id, USER_ID), confirmWriteOff(second.id, USER_ID)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
  });

  it("anular un cierre no revive activos dados de baja ni permite una segunda baja (auditoria run-2, F2)", async () => {
    const [fixed] = await createAssets(1, "1000.00");
    await classify(fixed!.id, { classification: "FIXED_ASSET", classId: await computerClassId() }, USER_ID);
    await confirmCost(fixed!.id, USER_ID);
    await updateDepreciationParams(fixed!.id, { usefulLifeMonths: 3, depreciationMethod: "LINEAR", residualValue: 0 });
    await capitalize(fixed!.id, { depreciationStartPeriod: "2025-01" }, USER_ID);
    const january = await closePeriod("2025-01", USER_ID);
    await createAssetMovement({ assetId: fixed!.id, movementType: "DECOMMISSIONED" });

    // Dado de baja operativamente: ya no se anula el cierre ni se toca su costo.
    await expect(voidRun(january.id, USER_ID)).rejects.toBeInstanceOf(ConflictError);
    await expect(updateDepreciationParams(fixed!.id, { usefulLifeMonths: 12 })).rejects.toBeInstanceOf(ConflictError);

    const writeOff = await draft([fixed!.id]);
    await updateWriteOff(writeOff.id, { writeOffDate: currentDate(), reason: "Siniestro" });
    await attachCertificate(writeOff.id, certificate());
    await addPhoto(writeOff.id, fixed!.id, photo(), USER_ID);
    await confirmWriteOff(writeOff.id, USER_ID);

    await expect(voidRun(january.id, USER_ID)).rejects.toThrow(/dados de baja/);
    expect(await getRecordOrThrow(fixed!.id)).toMatchObject({ stage: "WRITTEN_OFF" });
    expect((await listEligible({ ...PARAMS })).total).toBe(0);
  });

  it("la fecha no puede ser futura; quitar un activo borra sus fotos y descartar borra la carpeta", async () => {
    const [a, b] = [await decommissionedExpense(), await decommissionedExpense()];
    const writeOff = await draft([a.id, b.id]);
    await expect(updateWriteOff(writeOff.id, { writeOffDate: "2999-01-01" })).rejects.toBeInstanceOf(BadRequestError);

    const photoOfB = await addPhoto(writeOff.id, b.id, photo(), USER_ID);
    const folder = getAssetWriteOffFolder(writeOff.id);
    expect(fs.readdirSync(folder)).toHaveLength(1);

    const updated = await updateWriteOff(writeOff.id, { assetIds: [a.id] });
    expect(updated.lines.map((line) => line.assetId)).toEqual([a.id]);
    expect(fs.readdirSync(folder)).toHaveLength(0);
    await expect(removePhoto(writeOff.id, photoOfB.id)).rejects.toThrow(/no existe/);

    await attachCertificate(writeOff.id, certificate());
    await discardWriteOff(writeOff.id);
    expect(fs.existsSync(folder)).toBe(false);
    await expect(getWriteOffOrThrow(writeOff.id)).rejects.toThrow(/no existe/);
  });
});
