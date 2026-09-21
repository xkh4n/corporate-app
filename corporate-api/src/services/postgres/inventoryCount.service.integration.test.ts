import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { BadRequestError, ConflictError, ForbiddenError } from "../../library/errors";
import { createPerson } from "../mssql/person.service";
import { createUser } from "../mssql/user.service";
import { getRoleByName } from "./role.service";
import { createCostCenter } from "./costCenter.service";
import { createProduct } from "../mongo/product.service";
import { createProductCategory } from "../mongo/productCategory.service";
import type { AddInventoryLineInput } from "../../types/postgres/inventoryCount.types";
import { AssetKardexEntryModel } from "../../models/postgres/assetKardexEntry.model";
import { createAssetsFromReceipt, getAssetByTag } from "./asset.service";
import { assignAssetToUser, createAssetMovement, listCurrentHoldersByAssetIds } from "./assetMovement.service";
import { InventoryCountModel } from "../../models/postgres/inventoryCount.model";
import type { InventoryCountActor, UpdateInventoryLineInput } from "../../types/postgres/inventoryCount.types";
import * as inventoryCountService from "./inventoryCount.service";
import {
  closeInventoryCount,
  getCreatedAssetLabelData,
  getInventoryCountReport,
  listInventoryLines,
  startInventoryCount,
} from "./inventoryCount.service";

let seq = 0;

const actorOf = (user: { id: number }, isAdmin = false) => ({ userId: user.id, isAdmin });

// Ingresar, consultar, corregir y quitar equipos exigen ser el auditor que abrio la toma (o admin):
// salvo que el test indique otro actor, estos adaptadores actuan como el dueno de la toma.
async function ownerOf(countId: number): Promise<InventoryCountActor> {
  const count = await InventoryCountModel.findByPk(countId);
  return { userId: count!.createdBy!, isAdmin: false };
}
const addInventoryLine = async (countId: number, input: AddInventoryLineInput, actor?: InventoryCountActor) =>
  inventoryCountService.addInventoryLine(countId, input, actor ?? (await ownerOf(countId)));
const lookupAsset = async (countId: number, by: "TAG" | "SERIAL", value: string, actor?: InventoryCountActor) =>
  inventoryCountService.lookupAsset(countId, by, value, actor ?? (await ownerOf(countId)));
const updateInventoryLine = async (countId: number, lineId: number, input: UpdateInventoryLineInput, actor?: InventoryCountActor) =>
  inventoryCountService.updateInventoryLine(countId, lineId, input, actor ?? (await ownerOf(countId)));
const deleteInventoryLine = async (countId: number, lineId: number, actor?: InventoryCountActor) =>
  inventoryCountService.deleteInventoryLine(countId, lineId, actor ?? (await ownerOf(countId)));

const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: [
    "inventory_count_missing_assets",
    "inventory_count_lines",
    "inventory_counts",
    "inventory_count_counters",
    "asset_movement_users",
    "asset_movements",
    "asset_kardex_entries",
    "assets",
    "cost_centers",
  ],
  mongo: ["Product", "ProductCategory"],
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
    lastName: `AuditorIC${id}`,
    documentId: `TESTDOC-IC${id}`,
    email: `test-ic-${id}@example.com`,
  });
  return createUser({ personId: person.id, roleId: role.id, username: `testic${id}` });
}

async function createFixtureCatalog() {
  const costCenter = await createCostCenter({ code: 77000 + ++seq, name: "Centro de prueba IC" });
  const otherCostCenter = await createCostCenter({ code: 77000 + ++seq, name: "Otro centro IC" });
  const category = await createProductCategory({ name: `Categoria IC${++seq}` });
  const product = await createProduct({
    name: `Notebook IC${++seq}`,
    productType: "COMPRA",
    categoryId: String(category._id),
  });
  const otherCategory = await createProductCategory({ name: `Categoria otra IC${++seq}` });
  return {
    costCenter,
    otherCostCenter,
    categoryId: String(category._id),
    productId: String(product._id),
    otherCategoryId: String(otherCategory._id),
  };
}
type Catalog = Awaited<ReturnType<typeof createFixtureCatalog>>;

// Activo YA existente en el sistema (nacido de una recepcion), AVAILABLE.
async function createExistingAsset(catalog: Catalog, serial: string) {
  const [asset] = await createAssetsFromReceipt({
    goodsReceiptId: 990000 + ++seq,
    productId: catalog.productId,
    quantity: 1,
    costCenterId: catalog.costCenter.id,
    serialNumbers: [serial],
    finalStatusCode: "AVAILABLE",
  });
  return asset!;
}

type LineOverrides = Partial<Omit<AddInventoryLineInput, "lookupBy" | "tag" | "serialNumber">> & { createdBy: number };

// Ingreso identificando el equipo por su TAG.
const byTag = (catalog: Catalog, tag: string, overrides: LineOverrides & { serialNumber?: string }): AddInventoryLineInput => ({
  lookupBy: "TAG",
  tag,
  productCategoryId: catalog.categoryId,
  productId: catalog.productId,
  costCenterId: catalog.costCenter.id,
  statusCode: "AVAILABLE",
  ...overrides,
});

// Ingreso identificando el equipo por su SERIE.
const bySerial = (catalog: Catalog, serialNumber: string, overrides: LineOverrides): AddInventoryLineInput => ({
  lookupBy: "SERIAL",
  serialNumber,
  productCategoryId: catalog.categoryId,
  productId: catalog.productId,
  costCenterId: catalog.costCenter.id,
  statusCode: "AVAILABLE",
  ...overrides,
});

async function statusOf(tag: string) {
  return (await getAssetByTag(tag))!.status!.code;
}

describe("startInventoryCount", () => {
  it("crea la toma OPEN con folio y la retoma si el auditor ya tiene una abierta", async () => {
    const auditor = await createFixtureUser();

    const first = await startInventoryCount({ createdBy: auditor.id });
    expect(first.resumed).toBe(false);
    expect(first.count.status).toBe("OPEN");
    expect(first.count.number).toMatch(/^IT-\d{4}-000001$/);

    const second = await startInventoryCount({ createdBy: auditor.id });
    expect(second.resumed).toBe(true);
    expect(second.count.id).toBe(first.count.id);
  });

  it("dos Inicio simultaneos del mismo auditor dejan UNA sola toma abierta", async () => {
    const auditor = await createFixtureUser();
    const results = await Promise.all([
      startInventoryCount({ createdBy: auditor.id }),
      startInventoryCount({ createdBy: auditor.id }),
    ]);
    expect(results[0].count.id).toBe(results[1].count.id);
  });
});

describe("busqueda por TAG o por serie", () => {
  it("por TAG vincula el activo (en minusculas y con espacios) y toma su serie", async () => {
    const auditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-EXISTE");
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const line = await addInventoryLine(
      count.id,
      byTag(catalog, `  ${asset.tag.toLowerCase()} `, { serialNumber: "IGNORADA", createdBy: auditor.id }),
    );

    expect(line.assetCreated).toBe(false);
    expect(line.assetId).toBe(asset.id);
    // La serie de un activo existente es la del activo, no la que escribio el auditor.
    expect(line.serialNumber).toBe("SN-EXISTE");
    expect(line.assetModified).toBe(false);
  });

  it("por serie (sin distinguir mayusculas) encuentra el activo y sabe su TAG", async () => {
    const auditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-BUSCADA");
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const found = await lookupAsset(count.id, "SERIAL", " sn-buscada ");
    expect(found?.tag).toBe(asset.tag);
    expect(found?.serialNumber).toBe("SN-BUSCADA");

    const line = await addInventoryLine(count.id, bySerial(catalog, " sn-buscada ", { createdBy: auditor.id }));
    expect(line.assetCreated).toBe(false);
    expect(line.assetId).toBe(asset.id);
    expect(line.asset!.tag).toBe(asset.tag);
  });

  it("por serie inexistente da de alta un activo nuevo con esa serie", async () => {
    const auditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    expect(await lookupAsset(count.id, "SERIAL", "SN-NO-EXISTE")).toBeNull();
    const line = await addInventoryLine(count.id, bySerial(catalog, "SN-NO-EXISTE", { createdBy: auditor.id }));
    expect(line.assetCreated).toBe(true);
    expect((await getAssetByTag(line.asset!.tag))!.serialNumber).toBe("SN-NO-EXISTE");
  });

  it("una serie repetida en varios activos se rechaza (hay que ingresar por TAG)", async () => {
    const auditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const first = await createExistingAsset(catalog, "SN-REPE");
    const second = await createExistingAsset(catalog, "SN-REPE");
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const error = await addInventoryLine(count.id, bySerial(catalog, "SN-REPE", { createdBy: auditor.id })).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toContain(first.tag);
    expect((error as Error).message).toContain(second.tag);
    await expect(lookupAsset(count.id, "SERIAL", "SN-REPE")).rejects.toBeInstanceOf(ConflictError);
  });

  it("lookupAsset devuelve el activo con su tenedor, los estados permitidos y null si no existe", async () => {
    const auditor = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-LOOK");
    await assignAssetToUser({ assetId: asset.id, userId: holder.id });
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const found = await lookupAsset(count.id, "TAG", asset.tag);
    expect(found?.statusCode).toBe("ASSIGNED");
    expect(found?.holder?.userId).toBe(holder.id);
    expect(found?.productCategoryId).toBe(catalog.categoryId);
    expect(found?.alreadyInCount).toBe(false);
    // Un activo asignado no ofrece DISPONIBLE (registre su devolucion).
    expect(found?.allowedStatusCodes).toEqual(["ASSIGNED", "SUPPORT", "DAMAGED", "DECOMMISSIONED"]);
    expect(found?.forcedStatusCode).toBeNull();

    expect(await lookupAsset(count.id, "TAG", "ACT999999999")).toBeNull();
  });
});

describe("activo existente: la toma lo actualiza", () => {
  it("un disponible declarado ASIGNADO queda asignado al usuario ingresado", async () => {
    const auditor = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-ASIGNAR");
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const line = await addInventoryLine(
      count.id,
      byTag(catalog, asset.tag, { statusCode: "ASSIGNED", holderUserId: holder.id, createdBy: auditor.id }),
    );

    expect(await statusOf(asset.tag)).toBe("ASSIGNED");
    expect((await listCurrentHoldersByAssetIds([asset.id])).get(asset.id)).toBe(holder.id);
    expect(line.assetModified).toBe(true);
    expect(line.systemStatusCode).toBe("AVAILABLE");
    expect(line.resultingStatusCode).toBe("ASSIGNED");

    const report = await getInventoryCountReport(count.id);
    expect(report.lines[0]).toMatchObject({ statusCode: "ASSIGNED", systemStatusCode: "AVAILABLE", removable: false });
    expect(report.lines[0]!.changes).toEqual(["STATUS_CHANGED", "HOLDER_CHANGED"]);
    expect(report.lines[0]!.holder?.userId).toBe(holder.id);
    expect(report.summary.withChanges).toBe(1);
  });

  it("un asignado encontrado con otro usuario se reasigna; con el mismo usuario no cambia nada", async () => {
    const auditor = await createFixtureUser();
    const oldHolder = await createFixtureUser();
    const newHolder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const reassigned = await createExistingAsset(catalog, "SN-REASIGNAR");
    const same = await createExistingAsset(catalog, "SN-MISMO");
    await assignAssetToUser({ assetId: reassigned.id, userId: oldHolder.id });
    await assignAssetToUser({ assetId: same.id, userId: oldHolder.id });
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const movedLine = await addInventoryLine(
      count.id,
      byTag(catalog, reassigned.tag, { statusCode: "ASSIGNED", holderUserId: newHolder.id, createdBy: auditor.id }),
    );
    const sameLine = await addInventoryLine(
      count.id,
      byTag(catalog, same.tag, { statusCode: "ASSIGNED", holderUserId: oldHolder.id, createdBy: auditor.id }),
    );

    expect((await listCurrentHoldersByAssetIds([reassigned.id])).get(reassigned.id)).toBe(newHolder.id);
    expect(movedLine.assetModified).toBe(true);
    expect((await listCurrentHoldersByAssetIds([same.id])).get(same.id)).toBe(oldHolder.id);
    expect(sameLine.assetModified).toBe(false);
    const report = await getInventoryCountReport(count.id);
    expect(report.lines.find((line) => line.tag === same.tag)!.changes).toEqual([]);
    expect(report.lines.find((line) => line.tag === reassigned.tag)!.changes).toEqual(["HOLDER_CHANGED"]);
  });

  it("un activo en SOPORTE o DANADO declarado ASIGNADO se reasigna (pasa por DISPONIBLE)", async () => {
    const auditor = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const inSupport = await createExistingAsset(catalog, "SN-SOP");
    await createAssetMovement({ assetId: inSupport.id, movementType: "SUPPORT" });
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    await addInventoryLine(
      count.id,
      byTag(catalog, inSupport.tag, { statusCode: "ASSIGNED", holderUserId: holder.id, createdBy: auditor.id }),
    );
    expect(await statusOf(inSupport.tag)).toBe("ASSIGNED");
    expect((await listCurrentHoldersByAssetIds([inSupport.id])).get(inSupport.id)).toBe(holder.id);
  });

  it("un activo en devolucion queda en SOPORTE con la instruccion de enviarlo a Soporte TI / Adquisiciones TI", async () => {
    const auditor = await createFixtureUser();
    const previousHolder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-DEVUELTO");
    await assignAssetToUser({ assetId: asset.id, userId: previousHolder.id });
    await createAssetMovement({ assetId: asset.id, movementType: "MOVE_TO_RETURNED" });
    await createAssetMovement({ assetId: asset.id, movementType: "RETURNED" });
    expect(await statusOf(asset.tag)).toBe("RETURNED");
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const found = await lookupAsset(count.id, "TAG", asset.tag);
    expect(found?.statusCode).toBe("RETURNED");
    expect(found?.forcedStatusCode).toBe("SUPPORT");
    expect(found?.instruction).toContain("Soporte TI");

    const line = await addInventoryLine(count.id, byTag(catalog, asset.tag, { statusCode: "SUPPORT", createdBy: auditor.id }));

    expect(await statusOf(asset.tag)).toBe("SUPPORT");
    expect(line.resultingStatusCode).toBe("SUPPORT");
    const report = await getInventoryCountReport(count.id);
    expect(report.lines[0]).toMatchObject({ supportFollowUp: true, statusCode: "SUPPORT", systemStatusCode: "RETURNED" });
  });

  it("una baja encontrada en uso queda DEVALUATED con valor 0, asignada, y sin tocar el Kardex", async () => {
    const auditor = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-BAJA");
    await createAssetMovement({ assetId: asset.id, movementType: "DECOMMISSIONED" });
    const kardexBefore = await AssetKardexEntryModel.count({ where: { assetId: asset.id } });
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const found = await lookupAsset(count.id, "TAG", asset.tag);
    expect(found?.allowedStatusCodes).toEqual(["ASSIGNED", "DECOMMISSIONED"]);
    expect(found?.instruction).toContain("Devaluado");

    await addInventoryLine(
      count.id,
      byTag(catalog, asset.tag, { statusCode: "ASSIGNED", holderUserId: holder.id, createdBy: auditor.id }),
    );

    const after = await getAssetByTag(asset.tag);
    expect(after!.status!.code).toBe("DEVALUATED");
    expect(Number(after!.value)).toBe(0);
    expect((await listCurrentHoldersByAssetIds([asset.id])).get(asset.id)).toBe(holder.id);
    expect(await AssetKardexEntryModel.count({ where: { assetId: asset.id } })).toBe(kardexBefore);
  });

  it("una baja no admite otro estado que ASIGNADO o seguir de baja", async () => {
    const auditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-BAJA2");
    await createAssetMovement({ assetId: asset.id, movementType: "DECOMMISSIONED" });
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    await expect(
      addInventoryLine(count.id, byTag(catalog, asset.tag, { statusCode: "AVAILABLE", createdBy: auditor.id })),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("una transicion rechazada no deja cambios ni linea (asignado no puede quedar disponible)", async () => {
    const auditor = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-RECHAZO");
    await assignAssetToUser({ assetId: asset.id, userId: holder.id });
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    await expect(
      addInventoryLine(
        count.id,
        byTag(catalog, asset.tag, { statusCode: "AVAILABLE", costCenterId: catalog.otherCostCenter.id, createdBy: auditor.id }),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);

    const untouched = await getAssetByTag(asset.tag);
    expect(untouched!.status!.code).toBe("ASSIGNED");
    // El cambio de centro de costo tampoco quedo a medias.
    expect(untouched!.costCenterId).toBe(catalog.costCenter.id);
    const { items } = await listInventoryLines(count.id, { page: 1, limit: 50, sortBy: "id", sortOrder: "asc" });
    expect(items).toHaveLength(0);
  });

  it("la ubicacion (centro de costo) del activo pasa al centro donde se encontro", async () => {
    const auditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-UBICACION");
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const line = await addInventoryLine(
      count.id,
      byTag(catalog, asset.tag, { costCenterId: catalog.otherCostCenter.id, createdBy: auditor.id }),
    );

    expect((await getAssetByTag(asset.tag))!.costCenterId).toBe(catalog.otherCostCenter.id);
    expect(line.assetModified).toBe(true);
    expect(line.systemCostCenterId).toBe(catalog.costCenter.id);
    const report = await getInventoryCountReport(count.id);
    expect(report.lines[0]!.changes).toEqual(["COST_CENTER_CHANGED"]);
    expect(report.lines[0]!.systemCostCenter?.id).toBe(catalog.costCenter.id);
  });

  it("rechaza ingresar el mismo activo dos veces en la toma", async () => {
    const auditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-DUP");
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    await addInventoryLine(count.id, byTag(catalog, asset.tag, { createdBy: auditor.id }));
    await expect(
      addInventoryLine(count.id, bySerial(catalog, "SN-DUP", { createdBy: auditor.id })),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("alta de activo nuevo (TAG o serie inexistentes)", () => {
  it("por TAG inexistente crea un activo con tag generado, ignora el texto ingresado y aplica ASSIGNED con tenedor", async () => {
    const auditor = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const line = await addInventoryLine(
      count.id,
      byTag(catalog, "ETIQUETA-VIEJA-123", {
        serialNumber: "SN-NUEVO-1",
        statusCode: "ASSIGNED",
        holderUserId: holder.id,
        createdBy: auditor.id,
      }),
    );

    expect(line.assetCreated).toBe(true);
    const asset = await getAssetByTag(line.asset!.tag);
    expect(asset!.tag).toMatch(/^ACT\d{9}$/);
    expect(asset!.tag).not.toBe("ETIQUETA-VIEJA-123");
    expect(asset!.serialNumber).toBe("SN-NUEVO-1");
    expect(asset!.goodsReceiptId).toBeNull();
    expect(asset!.value).toBeNull();
    expect(asset!.status?.code).toBe("ASSIGNED");
    expect((await listCurrentHoldersByAssetIds([asset!.id])).get(asset!.id)).toBe(holder.id);
  });

  it("aplica DAMAGED, SUPPORT, AVAILABLE y DECOMMISSIONED", async () => {
    const auditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const statuses = ["DAMAGED", "SUPPORT", "AVAILABLE", "DECOMMISSIONED"] as const;
    for (const statusCode of statuses) {
      const line = await addInventoryLine(count.id, bySerial(catalog, `SN-${statusCode}`, { statusCode, createdBy: auditor.id }));
      expect(await statusOf(line.asset!.tag)).toBe(statusCode);
    }
  });

  it("rechaza ASSIGNED sin usuario", async () => {
    const auditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    await expect(
      addInventoryLine(count.id, bySerial(catalog, "SN-X", { statusCode: "ASSIGNED", createdBy: auditor.id })),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("por TAG inexistente exige la serie, y la rechaza si ya es de otro activo (indicando su tag)", async () => {
    const auditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const existing = await createExistingAsset(catalog, "SN-REPETIDA");
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    await expect(addInventoryLine(count.id, byTag(catalog, "TAG-X", { createdBy: auditor.id }))).rejects.toBeInstanceOf(
      BadRequestError,
    );

    const error = await addInventoryLine(
      count.id,
      byTag(catalog, "TAG-X", { serialNumber: " sn-repetida ", createdBy: auditor.id }),
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toContain(existing.tag);
  });

  it("dos altas simultaneas con la misma serie crean UN solo activo", async () => {
    const auditor = await createFixtureUser();
    const otherAuditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const first = await startInventoryCount({ createdBy: auditor.id });
    const second = await startInventoryCount({ createdBy: otherAuditor.id });

    const results = await Promise.allSettled([
      addInventoryLine(first.count.id, bySerial(catalog, "SN-CARRERA", { createdBy: auditor.id })),
      addInventoryLine(second.count.id, bySerial(catalog, "SN-CARRERA", { createdBy: otherAuditor.id })),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("rechaza un producto que no pertenece a la categoria elegida", async () => {
    const auditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    await expect(
      addInventoryLine(
        count.id,
        bySerial(catalog, "SN-CAT", { productCategoryId: catalog.otherCategoryId, createdBy: auditor.id }),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("lineas: edicion y borrado", () => {
  it("solo se quita una linea que no creo ni modifico el activo; solo se edita la descripcion", async () => {
    const auditor = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const untouched = await createExistingAsset(catalog, "SN-SIN-CAMBIO");
    const modified = await createExistingAsset(catalog, "SN-CAMBIADO");
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const untouchedLine = await addInventoryLine(count.id, byTag(catalog, untouched.tag, { createdBy: auditor.id }));
    const modifiedLine = await addInventoryLine(
      count.id,
      byTag(catalog, modified.tag, { statusCode: "ASSIGNED", holderUserId: holder.id, createdBy: auditor.id }),
    );
    const createdLine = await addInventoryLine(count.id, bySerial(catalog, "SN-CREADO", { createdBy: auditor.id }));

    const updated = await updateInventoryLine(count.id, modifiedLine.id, { description: "Con funda" });
    expect(updated.description).toBe("Con funda");

    await expect(deleteInventoryLine(count.id, modifiedLine.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteInventoryLine(count.id, createdLine.id)).rejects.toBeInstanceOf(ConflictError);
    await deleteInventoryLine(count.id, untouchedLine.id);

    const { items } = await listInventoryLines(count.id, { page: 1, limit: 50, sortBy: "id", sortOrder: "asc" });
    expect(items.map((item) => item.id)).toEqual([modifiedLine.id, createdLine.id]);
    expect(items.map((item) => item.removable)).toEqual([false, false]);
  });
});

describe("closeInventoryCount", () => {
  it("congela los activos no encontrados (sin los dados de baja), devuelve los creados y deja la toma inmutable", async () => {
    const auditor = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const seen = await createExistingAsset(catalog, "SN-VISTO");
    const notSeen = await createExistingAsset(catalog, "SN-NO-VISTO");
    const notSeenAssigned = await createExistingAsset(catalog, "SN-NO-VISTO-ASIG");
    await assignAssetToUser({ assetId: notSeenAssigned.id, userId: holder.id });
    const decommissioned = await createExistingAsset(catalog, "SN-BAJA");
    await createAssetMovement({ assetId: decommissioned.id, movementType: "DECOMMISSIONED" });

    const { count } = await startInventoryCount({ createdBy: auditor.id });
    await addInventoryLine(count.id, byTag(catalog, seen.tag, { createdBy: auditor.id }));
    const created = await addInventoryLine(count.id, bySerial(catalog, "SN-ALTA", { createdBy: auditor.id }));

    const closed = await closeInventoryCount(count.id, actorOf(auditor));
    expect(closed.count.status).toBe("CLOSED");
    expect(closed.createdAssetIds).toEqual([created.assetId]);

    const report = await getInventoryCountReport(count.id);
    const missingTags = report.missingAssets.map((asset) => asset.tag).sort();
    expect(missingTags).toEqual([notSeen.tag, notSeenAssigned.tag].sort());
    expect(report.summary.missingAssets).toBe(2);
    expect(report.summary.createdAssets).toBe(1);
    expect(report.summary.linkedLines).toBe(1);
    const assigned = report.missingAssets.find((asset) => asset.tag === notSeenAssigned.tag);
    expect(assigned?.systemHolder?.userId).toBe(holder.id);

    // Inmutable tras el cierre.
    await expect(
      addInventoryLine(count.id, bySerial(catalog, "SN-TARDE", { createdBy: auditor.id })),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(closeInventoryCount(count.id, actorOf(auditor))).rejects.toBeInstanceOf(ConflictError);

    // El reporte de una toma cerrada no cambia aunque el sistema cambie despues.
    await assignAssetToUser({ assetId: notSeen.id, userId: holder.id });
    const again = await getInventoryCountReport(count.id);
    expect(again.missingAssets.map((asset) => asset.tag).sort()).toEqual(missingTags);
  });

  it("solo el auditor que inicio la toma o un administrador puede cerrarla", async () => {
    const auditor = await createFixtureUser();
    const other = await createFixtureUser();
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    await expect(closeInventoryCount(count.id, actorOf(other))).rejects.toBeInstanceOf(ForbiddenError);
    const stillOpen = await startInventoryCount({ createdBy: auditor.id });
    expect(stillOpen.resumed).toBe(true);

    const closed = await closeInventoryCount(count.id, actorOf(other, true));
    expect(closed.count.status).toBe("CLOSED");
  });

  it("un usuario tipeado con un estado sin tenedor (mantencion) se descarta en la linea", async () => {
    const auditor = await createFixtureUser();
    const typedUser = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-SUP-HOLDER");
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const line = await addInventoryLine(
      count.id,
      byTag(catalog, asset.tag, { statusCode: "SUPPORT", holderUserId: typedUser.id, createdBy: auditor.id }),
    );

    expect(line.holderUserId).toBeNull();
    const report = await getInventoryCountReport(count.id);
    expect(report.lines[0]!.holder).toBeNull();
    expect(report.lines[0]!.changes).not.toContain("HOLDER_CHANGED");
  });

  it("tras cerrar, el auditor puede abrir otra toma", async () => {
    const auditor = await createFixtureUser();
    const first = await startInventoryCount({ createdBy: auditor.id });
    await closeInventoryCount(first.count.id, actorOf(auditor));

    const second = await startInventoryCount({ createdBy: auditor.id });
    expect(second.resumed).toBe(false);
    expect(second.count.id).not.toBe(first.count.id);
  });
});

describe("getCreatedAssetLabelData", () => {
  it("devuelve solo las etiquetas de los activos creados por la toma", async () => {
    const auditor = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const existing = await createExistingAsset(catalog, "SN-VIEJO");
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    await addInventoryLine(count.id, byTag(catalog, existing.tag, { createdBy: auditor.id }));
    const created = await addInventoryLine(count.id, bySerial(catalog, "SN-ETIQUETA", { createdBy: auditor.id }));

    const labels = await getCreatedAssetLabelData(count.id);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.tag).toBe(created.asset!.tag);
    expect(labels[0]!.serialNumber).toBe("SN-ETIQUETA");
  });
});

describe("movimientos MOVE_TO_RETURNED, RETURNED y DEVALUATED", () => {
  it("MOVE_TO_RETURNED solo desde un activo asignado y RETURNED solo desde MOVE_TO_RETURNED; el activo queda sin tenedor", async () => {
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-RET");

    await expect(createAssetMovement({ assetId: asset.id, movementType: "MOVE_TO_RETURNED" })).rejects.toBeInstanceOf(
      ConflictError,
    );

    await assignAssetToUser({ assetId: asset.id, userId: holder.id });
    // Sin pasar por el despacho no se puede dar por recibido.
    await expect(createAssetMovement({ assetId: asset.id, movementType: "RETURNED" })).rejects.toBeInstanceOf(ConflictError);

    await createAssetMovement({ assetId: asset.id, movementType: "MOVE_TO_RETURNED" });
    expect(await statusOf(asset.tag)).toBe("MOVE_TO_RETURNED");
    expect((await listCurrentHoldersByAssetIds([asset.id])).has(asset.id)).toBe(false);

    await createAssetMovement({ assetId: asset.id, movementType: "RETURNED" });
    expect(await statusOf(asset.tag)).toBe("RETURNED");
    expect((await listCurrentHoldersByAssetIds([asset.id])).has(asset.id)).toBe(false);
  });

  it("DEVALUATED solo desde una baja; exige usuario, deja valor 0 y no escribe Kardex", async () => {
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-DEV");

    await expect(
      createAssetMovement({ assetId: asset.id, movementType: "DEVALUATED", userIds: [holder.id] }),
    ).rejects.toBeInstanceOf(ConflictError);

    await createAssetMovement({ assetId: asset.id, movementType: "DECOMMISSIONED" });
    await expect(createAssetMovement({ assetId: asset.id, movementType: "DEVALUATED" })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    const kardexBefore = await AssetKardexEntryModel.count({ where: { assetId: asset.id } });

    await createAssetMovement({ assetId: asset.id, movementType: "DEVALUATED", userIds: [holder.id] });
    expect(await statusOf(asset.tag)).toBe("DEVALUATED");
    expect(Number((await getAssetByTag(asset.tag))!.value)).toBe(0);
    expect((await listCurrentHoldersByAssetIds([asset.id])).get(asset.id)).toBe(holder.id);
    expect(await AssetKardexEntryModel.count({ where: { assetId: asset.id } })).toBe(kardexBefore);
  });
});

describe("solo el auditor de la toma la modifica", () => {
  it("otro usuario no puede consultar, ingresar, corregir ni quitar equipos; un administrador si", async () => {
    const auditor = await createFixtureUser();
    const stranger = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const first = await createExistingAsset(catalog, "SN-PROP-1");
    const second = await createExistingAsset(catalog, "SN-PROP-2");
    const { count } = await startInventoryCount({ createdBy: auditor.id });
    const line = await addInventoryLine(count.id, byTag(catalog, first.tag, { createdBy: auditor.id }));
    const other = actorOf(stranger);

    await expect(lookupAsset(count.id, "TAG", second.tag, other)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      addInventoryLine(count.id, byTag(catalog, second.tag, { createdBy: stranger.id, statusCode: "SUPPORT" }), other),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateInventoryLine(count.id, line.id, { description: "cambiada" }, other)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteInventoryLine(count.id, line.id, other)).rejects.toBeInstanceOf(ForbiddenError);

    // Nada cambio: la linea sigue, sin descripcion, y el otro activo no se toco.
    const { items } = await listInventoryLines(count.id, { page: 1, limit: 50, sortBy: "id", sortOrder: "asc" });
    expect(items).toHaveLength(1);
    expect(items[0]!.description).toBeNull();
    expect(await statusOf(second.tag)).toBe("AVAILABLE");

    // El administrador si puede, aunque no haya abierto la toma.
    const admin = actorOf(stranger, true);
    const added = await addInventoryLine(count.id, byTag(catalog, second.tag, { createdBy: stranger.id }), admin);
    expect(added.assetId).toBe(second.id);
    await expect(updateInventoryLine(count.id, line.id, { description: "ok" }, admin)).resolves.toBeDefined();
    await expect(deleteInventoryLine(count.id, line.id, admin)).resolves.toBeUndefined();
  });

  it("el tercero recibe 403 antes que el estado: no se entera de si la toma esta cerrada", async () => {
    const auditor = await createFixtureUser();
    const stranger = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createExistingAsset(catalog, "SN-PROP-3");
    const { count } = await startInventoryCount({ createdBy: auditor.id });
    await closeInventoryCount(count.id, actorOf(auditor));

    await expect(
      addInventoryLine(count.id, byTag(catalog, asset.tag, { createdBy: stranger.id }), actorOf(stranger)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      addInventoryLine(count.id, byTag(catalog, asset.tag, { createdBy: auditor.id }), actorOf(auditor)),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
