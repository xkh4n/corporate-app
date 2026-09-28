import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { BadRequestError, ConflictError, NotFoundError } from "../../library/errors";
import { createPerson } from "../mssql/person.service";
import { createUser, deactivateUser } from "../mssql/user.service";
import { getRoleByName } from "../postgres/role.service";
import { createCostCenter } from "./costCenter.service";
import { createProduct } from "../mongo/product.service";
import { createProductCategory } from "../mongo/productCategory.service";
import { createAssetsFromReceipt, getAssetByIdOrThrow } from "./asset.service";
import {
  assignAssetToUser,
  createAssetMovement,
  getAssetHandoverData,
  getCurrentAssignment,
  listAssignments,
  reassignAsset,
} from "./assetMovement.service";

// Plan 011 (Movimiento de Activos): reasignar, asignacion vigente y listado.
let seq = 0;

const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: ["asset_kardex_entries", "asset_movement_users", "asset_movements", "assets", "cost_centers"],
  mongo: ["Product", "ProductCategory"],
};

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  await resetTestData(RESET_TABLES);
});

const PAGE = { page: 1, limit: 50, sortBy: "tag", sortOrder: "asc" as const };

async function createEmployee(lastName = `Reasigna${++seq}`) {
  const userRole = await getRoleByName("user");
  if (!userRole) throw new Error('Falta el rol "user" sembrado -revisar migratePostgres()');
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName,
    documentId: `TESTDOC-RA${id}`,
    email: `test-ra-${id}@example.com`,
  });
  return createUser({ personId: person.id, roleId: userRole.id, username: `testra${id}` });
}

async function createCostCenterFixture(name: string) {
  return createCostCenter({ code: 89000 + ++seq, name });
}

// Un activo AVAILABLE con producto (y categoria) en un centro de costo.
async function createAvailableAsset(options: { costCenterId: number; categoryId?: string; serial?: string }) {
  const product = await createProduct({
    name: `Producto RA${++seq}`,
    productType: "COMPRA",
    ...(options.categoryId ? { categoryId: options.categoryId } : {}),
  });
  const [asset] = await createAssetsFromReceipt({
    goodsReceiptId: 778_000 + ++seq,
    productId: String(product._id),
    quantity: 1,
    costCenterId: options.costCenterId,
    serialNumbers: [options.serial ?? `SERIE-RA-${seq}`],
    finalStatusCode: "AVAILABLE",
  });
  if (!asset) throw new Error("No se creo el activo de prueba");
  return asset;
}

describe("Movimiento de Activos (plan 011, integracion)", () => {
  describe("reassignAsset", () => {
    it("a otro usuario: movimiento REASSIGNED, nuevo tenedor y acta con su nombre", async () => {
      const costCenter = await createCostCenterFixture("CC RA origen");
      const asset = await createAvailableAsset({ costCenterId: costCenter.id });
      const from = await createEmployee("Origen");
      const to = await createEmployee("Destino");
      await assignAssetToUser({ assetId: asset.id, userId: from.id, supervisorName: "Jefa Uno" });

      const movement = await reassignAsset({ assetId: asset.id, userId: to.id, supervisorName: "Jefe Dos", hasCharger: true });

      expect(movement.movementType).toBe("REASSIGNED");
      expect(movement.notes).toContain("Origen");
      expect(movement.notes).toContain("Destino");
      expect((await getAssetByIdOrThrow(asset.id)).status?.code).toBe("ASSIGNED");
      const current = await getCurrentAssignment(asset.id);
      expect(current.holder.userId).toBe(to.id);
      expect(current.movementId).toBe(movement.id);
      expect(current.handover.supervisorName).toBe("Jefe Dos");
      const handover = await getAssetHandoverData(movement.id);
      expect(handover.employeeName).toContain("Destino");
    });

    it("solo centro de costo: movimiento con el mismo usuario, activo movido y nota del cambio", async () => {
      const origin = await createCostCenterFixture("CC RA uno");
      const target = await createCostCenterFixture("CC RA dos");
      const asset = await createAvailableAsset({ costCenterId: origin.id });
      const holder = await createEmployee();
      await assignAssetToUser({ assetId: asset.id, userId: holder.id });

      const movement = await reassignAsset({ assetId: asset.id, costCenterId: target.id });

      expect(movement.movementType).toBe("REASSIGNED");
      expect(movement.notes).toContain("CC RA uno");
      expect(movement.notes).toContain("CC RA dos");
      expect((await getAssetByIdOrThrow(asset.id)).costCenterId).toBe(target.id);
      const current = await getCurrentAssignment(asset.id);
      expect(current.holder.userId).toBe(holder.id);
      expect(current.costCenter?.id).toBe(target.id);
      expect((await getAssetHandoverData(movement.id)).costCenterName).toBe("CC RA dos");
    });

    it("sin cambios es 400; un activo disponible es 409; un usuario inactivo es 409", async () => {
      const costCenter = await createCostCenterFixture("CC RA guardas");
      const asset = await createAvailableAsset({ costCenterId: costCenter.id });
      const holder = await createEmployee();

      await expect(reassignAsset({ assetId: asset.id, userId: holder.id })).rejects.toBeInstanceOf(ConflictError);

      await assignAssetToUser({ assetId: asset.id, userId: holder.id });
      await expect(
        reassignAsset({ assetId: asset.id, userId: holder.id, costCenterId: costCenter.id }),
      ).rejects.toBeInstanceOf(BadRequestError);

      const inactive = await createEmployee();
      await deactivateUser(inactive.id);
      await expect(reassignAsset({ assetId: asset.id, userId: inactive.id })).rejects.toBeInstanceOf(ConflictError);
    });

    it("un activo devaluado sigue devaluado y con valor 0", async () => {
      const costCenter = await createCostCenterFixture("CC RA devaluado");
      const asset = await createAvailableAsset({ costCenterId: costCenter.id });
      const from = await createEmployee();
      const to = await createEmployee();
      await createAssetMovement({ assetId: asset.id, movementType: "DECOMMISSIONED" });
      await createAssetMovement({ assetId: asset.id, movementType: "DEVALUATED", userIds: [from.id] });

      const movement = await reassignAsset({ assetId: asset.id, userId: to.id });

      expect(movement.movementType).toBe("DEVALUATED");
      const updated = await getAssetByIdOrThrow(asset.id);
      expect(updated.status?.code).toBe("DEVALUATED");
      expect(Number(updated.value)).toBe(0);
      expect((await getCurrentAssignment(asset.id)).holder.userId).toBe(to.id);
    });
  });

  describe("acta de entrega", () => {
    it("toma marca y modelo del producto y el tipo de equipo de su categoria", async () => {
      const costCenter = await createCostCenterFixture("CC RA acta");
      const desktops = await createProductCategory({ name: `DESKTOPS RA${++seq}` });
      const product = await createProduct({
        name: `Producto acta RA${++seq}`,
        productType: "COMPRA",
        categoryId: String(desktops._id),
        brand: "LENOVO",
        productModel: "THINKCENTRE M79",
      });
      const [asset] = await createAssetsFromReceipt({
        goodsReceiptId: 779_000 + ++seq,
        productId: String(product._id),
        quantity: 1,
        costCenterId: costCenter.id,
        finalStatusCode: "AVAILABLE",
      });
      const holder = await createEmployee();
      const movement = await assignAssetToUser({ assetId: asset!.id, userId: holder.id });

      const data = await getAssetHandoverData(movement.id);
      expect(data.productBrand).toBe("LENOVO");
      expect(data.productModel).toBe("THINKCENTRE M79");
      expect(data.equipmentKind).toBe("DESKTOP");
    });
  });

  describe("getCurrentAssignment", () => {
    it("404 si el activo no esta en manos de nadie", async () => {
      const costCenter = await createCostCenterFixture("CC RA sin tenedor");
      const asset = await createAvailableAsset({ costCenterId: costCenter.id });
      await expect(getCurrentAssignment(asset.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("listAssignments", () => {
    it("lista solo activos en uso y filtra por centro de costo, serie, categoria y usuario", async () => {
      const ccA = await createCostCenterFixture("CC RA lista A");
      const ccB = await createCostCenterFixture("CC RA lista B");
      const notebooks = await createProductCategory({ name: `Notebooks RA${++seq}` });
      const monitors = await createProductCategory({ name: `Monitores RA${++seq}` });
      const ana = await createEmployee("Anabella");
      const beto = await createEmployee("Bernardo");

      const assetA = await createAvailableAsset({ costCenterId: ccA.id, categoryId: String(notebooks._id), serial: "NB-RA-001" });
      const assetB = await createAvailableAsset({ costCenterId: ccB.id, categoryId: String(monitors._id), serial: "MN-RA-002" });
      const free = await createAvailableAsset({ costCenterId: ccA.id, categoryId: String(notebooks._id) });
      await assignAssetToUser({ assetId: assetA.id, userId: ana.id });
      await assignAssetToUser({ assetId: assetB.id, userId: beto.id });

      const all = await listAssignments(PAGE, {});
      expect(all.total).toBe(2);
      expect(all.items.map((row) => row.assetId)).not.toContain(free.id);
      const rowA = all.items.find((row) => row.assetId === assetA.id);
      expect(rowA?.holder?.fullName).toContain("Anabella");
      expect(rowA?.categoryName).toBe(notebooks.name);
      expect(rowA?.costCenter?.id).toBe(ccA.id);
      expect(rowA?.movementId).not.toBeNull();

      const ids = async (filters: Parameters<typeof listAssignments>[1]) =>
        (await listAssignments(PAGE, filters)).items.map((row) => row.assetId);
      expect(await ids({ costCenterId: ccB.id })).toEqual([assetB.id]);
      expect(await ids({ serial: "NB-RA" })).toEqual([assetA.id]);
      expect(await ids({ serial: assetB.tag })).toEqual([assetB.id]);
      expect(await ids({ categoryId: String(monitors._id) })).toEqual([assetB.id]);
      expect(await ids({ user: "Anabella" })).toEqual([assetA.id]);
      expect(await ids({ user: "NadieConEsteNombre" })).toEqual([]);
      expect(await ids({ serial: "%" })).toEqual([]);
    });
  });
});
