import { QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "../../models/postgres/asset.model";
import { ConflictError } from "../../library/errors";
import type { ParsedImportRow } from "../../library/csvImport";
import { createPerson } from "../mssql/person.service";
import { createUser, deactivateUser } from "../mssql/user.service";
import { createProduct, deactivateProduct } from "../mongo/product.service";
import { createProductCategory } from "../mongo/productCategory.service";
import { getRoleByName } from "./role.service";
import { createCostCenter } from "./costCenter.service";
import { createAssetForImportRow, resolveImportRows } from "./assetImport.service";
import { listCurrentHoldersByAssetIds } from "./assetMovement.service";
import { createAssetsFromReceipt } from "./asset.service";
import type { ResolvedImportRow } from "../../types/postgres/assetImport.types";

const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: ["asset_movement_users", "asset_movements", "asset_kardex_entries", "assets", "cost_centers"],
  mongo: ["Product", "ProductCategory"],
};

let seq = 0;

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  await resetTestData(RESET_TABLES);
});

async function createHolder() {
  const role = await getRoleByName("user");
  if (!role) throw new Error('Falta el rol "user" sembrado');
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `Import${id}`,
    documentId: `TESTDOC-IMP${id}`,
    email: `test-import-${id}@example.com`,
  });
  const user = await createUser({ personId: person.id, roleId: role.id, username: `testimport${id}` });
  return { user, person };
}

async function createCatalog() {
  const costCenter = await createCostCenter({ code: 70000 + ++seq, name: "Centro import" });
  const category = await createProductCategory({ name: `Categoria import ${++seq}` });
  const product = await createProduct({
    name: `Producto import ${++seq}`,
    productType: "COMPRA",
    categoryId: String(category._id),
  });
  return { costCenter, category, product };
}

function parsed(over: Partial<ParsedImportRow> & Pick<ParsedImportRow, "serialNumber" | "product" | "costCenterCode">): ParsedImportRow {
  return {
    row: 2,
    category: null,
    statusCode: "AVAILABLE",
    assignedUsername: null,
    assignedRut: null,
    warrantyExpiresAt: null,
    ...over,
  };
}

function resolved(over: Partial<ResolvedImportRow> & Pick<ResolvedImportRow, "serialNumber" | "productId" | "costCenterId">): ResolvedImportRow {
  return { row: 2, productType: "COMPRA", statusCode: "AVAILABLE", holderUserId: null, warrantyExpiresAt: null, ...over };
}

const context = (actorUserId: number, over: Partial<Parameters<typeof createAssetForImportRow>[1]> = {}) => ({
  jobId: "00000000-0000-4000-8000-000000000001",
  actorUserId,
  jobStartedAt: new Date(Date.now() - 60_000),
  mayAdopt: false,
  ...over,
});

describe("resolveImportRows", () => {
  it("resuelve producto, categoria, centro de costo y usuario (por username y por RUT)", async () => {
    const { costCenter, category, product } = await createCatalog();
    const byName = await createHolder();
    const byRut = await createHolder();

    const { rows, issues } = await resolveImportRows([
      parsed({ row: 2, serialNumber: "SN-1", product: product.name, costCenterCode: costCenter.code }),
      parsed({
        row: 3,
        serialNumber: "SN-2",
        product: product.name,
        category: category.name.toUpperCase(),
        costCenterCode: costCenter.code,
        statusCode: "ASSIGNED",
        assignedUsername: byName.user.username.toUpperCase(),
      }),
      parsed({
        row: 4,
        serialNumber: "SN-3",
        product: product.name,
        costCenterCode: costCenter.code,
        statusCode: "ASSIGNED",
        assignedRut: byRut.person.documentId,
      }),
    ]);

    expect(issues).toEqual([]);
    expect(rows.map((row) => [row.row, row.productId, row.productType, row.costCenterId, row.holderUserId])).toEqual([
      [2, String(product._id), "COMPRA", costCenter.id, null],
      [3, String(product._id), "COMPRA", costCenter.id, byName.user.id],
      [4, String(product._id), "COMPRA", costCenter.id, byRut.user.id],
    ]);
  });

  it("informa cada problema en su fila sin cortar las demas", async () => {
    const { costCenter, category, product } = await createCatalog();
    const inactive = await createProduct({ name: `Inactivo import ${++seq}`, productType: "COMPRA" });
    await deactivateProduct(String(inactive._id));
    const deactivated = await createHolder();
    await deactivateUser(deactivated.user.id);
    const [existing] = await createAssetsFromReceipt({
      goodsReceiptId: 970000 + ++seq,
      productId: String(product._id),
      quantity: 1,
      costCenterId: costCenter.id,
      serialNumbers: ["SN-EXISTE"],
      finalStatusCode: "AVAILABLE",
    });

    const { rows, issues } = await resolveImportRows([
      parsed({ row: 2, serialNumber: "SN-OK", product: product.name, costCenterCode: costCenter.code }),
      parsed({ row: 3, serialNumber: "SN-A", product: "No existe", costCenterCode: costCenter.code }),
      parsed({ row: 4, serialNumber: "SN-B", product: inactive.name, costCenterCode: costCenter.code }),
      parsed({ row: 5, serialNumber: "SN-C", product: product.name, category: "OTRA CATEGORIA", costCenterCode: costCenter.code }),
      parsed({ row: 6, serialNumber: "SN-D", product: product.name, costCenterCode: 1 }),
      parsed({ row: 7, serialNumber: "SN-E", product: product.name, costCenterCode: costCenter.code, statusCode: "ASSIGNED", assignedUsername: "nadie" }),
      parsed({ row: 8, serialNumber: "SN-F", product: product.name, costCenterCode: costCenter.code, statusCode: "ASSIGNED", assignedRut: deactivated.person.documentId }),
      parsed({ row: 9, serialNumber: " sn-existe ", product: product.name, costCenterCode: costCenter.code }),
    ]);

    expect(rows.map((row) => row.row)).toEqual([2]);
    expect(issues.map((issue) => `${issue.row}:${issue.column}`)).toEqual([
      "3:product",
      "4:product",
      "5:category",
      "6:cost_center_code",
      "7:assigned_username",
      "8:assigned_rut",
      "9:serial_number",
    ]);
    expect(issues.find((issue) => issue.row === 9)?.message).toContain(existing!.tag);
    expect(issues.find((issue) => issue.row === 4)?.message).toContain("inactivo");
  });
});

describe("createAssetForImportRow", () => {
  it("crea el activo AVAILABLE con tag generado, sin valor ni Kardex, con garantia y autor", async () => {
    const { costCenter, product } = await createCatalog();
    const { user } = await createHolder();

    const result = await createAssetForImportRow(
      resolved({ serialNumber: "SN-NEW", productId: String(product._id), costCenterId: costCenter.id, warrantyExpiresAt: "2028-01-31" }),
      context(user.id),
    );

    expect(result.adopted).toBe(false);
    expect(result.tag).toMatch(/^ACT\d{9}$/);
    const asset = await AssetModel.findOne({ where: { tag: result.tag } });
    expect(asset).toMatchObject({
      serialNumber: "SN-NEW",
      productId: String(product._id),
      costCenterId: costCenter.id,
      value: null,
      warrantyExpiresAt: "2028-01-31",
      createdBy: user.id,
    });
    const [kardex] = await postgres.query<{ n: string }>("SELECT count(*)::text AS n FROM asset_kardex_entries", { type: QueryTypes.SELECT });
    expect(kardex!.n).toBe("0");
  });

  it("aplica el estado declarado: ASSIGNED deja al usuario como tenedor, SUPPORT y DAMAGED cambian el estado", async () => {
    const { costCenter, product } = await createCatalog();
    const { user: actor } = await createHolder();
    const { user: holder } = await createHolder();
    const base = { productId: String(product._id), costCenterId: costCenter.id };

    const assigned = await createAssetForImportRow(
      resolved({ ...base, serialNumber: "SN-AS", statusCode: "ASSIGNED", holderUserId: holder.id }),
      context(actor.id),
    );
    const support = await createAssetForImportRow(resolved({ ...base, serialNumber: "SN-SU", statusCode: "SUPPORT" }), context(actor.id));
    const damaged = await createAssetForImportRow(resolved({ ...base, serialNumber: "SN-DA", statusCode: "DAMAGED" }), context(actor.id));

    const statusOf = async (tag: string) => {
      const asset = await AssetModel.findOne({ where: { tag }, include: ["status"] });
      return { id: asset!.id, code: asset!.status?.code };
    };
    const assignedAsset = await statusOf(assigned.tag);
    expect(assignedAsset.code).toBe("ASSIGNED");
    expect((await listCurrentHoldersByAssetIds([assignedAsset.id])).get(assignedAsset.id)).toBe(holder.id);
    expect((await statusOf(support.tag)).code).toBe("SUPPORT");
    expect((await statusOf(damaged.tag)).code).toBe("DAMAGED");
  });

  it("rechaza una serie que ya existe informando su tag y no deja cambios", async () => {
    const { costCenter, product } = await createCatalog();
    const { user } = await createHolder();
    const [existing] = await createAssetsFromReceipt({
      goodsReceiptId: 970000 + ++seq,
      productId: String(product._id),
      quantity: 1,
      costCenterId: costCenter.id,
      serialNumbers: ["SN-DUP"],
      finalStatusCode: "AVAILABLE",
    });
    const before = await AssetModel.count();

    const attempt = createAssetForImportRow(
      resolved({ serialNumber: " sn-dup ", productId: String(product._id), costCenterId: costCenter.id }),
      context(user.id),
    );
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toThrow(existing!.tag);
    expect(await AssetModel.count()).toBe(before);
  });

  it("una transaccion que falla a mitad (usuario inexistente) no deja el activo a medias", async () => {
    const { costCenter, product } = await createCatalog();
    const { user } = await createHolder();

    await expect(
      createAssetForImportRow(
        resolved({ serialNumber: "SN-ROLLBACK", productId: String(product._id), costCenterId: costCenter.id, statusCode: "ASSIGNED", holderUserId: 987654 }),
        context(user.id),
      ),
    ).rejects.toThrow();
    expect(await AssetModel.count({ where: { serialNumber: "SN-ROLLBACK" } })).toBe(0);
  });

  it("adopta una fila ya confirmada solo si se reanuda y el activo es de esa fila; si no, es duplicado", async () => {
    const { costCenter, product } = await createCatalog();
    const { user } = await createHolder();
    const { user: other } = await createHolder();
    const row = resolved({ serialNumber: "SN-ADOPT", productId: String(product._id), costCenterId: costCenter.id });

    const first = await createAssetForImportRow(row, context(user.id));

    // Primer intento (mayAdopt = false): el activo existente es un duplicado, no se adopta.
    await expect(createAssetForImportRow(row, context(user.id))).rejects.toBeInstanceOf(ConflictError);
    // Reanudado, mismo usuario, mismo producto y centro: se adopta con su mismo tag.
    await expect(createAssetForImportRow(row, context(user.id, { mayAdopt: true }))).resolves.toEqual({ tag: first.tag, adopted: true });
    // Otro usuario, otro centro de costo o creado ANTES del inicio del trabajo: duplicado.
    await expect(createAssetForImportRow(row, context(other.id, { mayAdopt: true }))).rejects.toBeInstanceOf(ConflictError);
    const otherCostCenter = await createCostCenter({ code: 70000 + ++seq, name: "Otro centro" });
    await expect(
      createAssetForImportRow({ ...row, costCenterId: otherCostCenter.id }, context(user.id, { mayAdopt: true })),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createAssetForImportRow(row, context(user.id, { mayAdopt: true, jobStartedAt: new Date(Date.now() + 120_000) })),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await AssetModel.count({ where: { serialNumber: "SN-ADOPT" } })).toBe(1);
  });

  it("no adopta un activo con la misma serie pero otra garantia u otro estado (creado por otra via)", async () => {
    const { costCenter, product } = await createCatalog();
    const { user } = await createHolder();
    const base = { serialNumber: "SN-STRICT", productId: String(product._id), costCenterId: costCenter.id };
    await createAssetForImportRow(resolved({ ...base, warrantyExpiresAt: "2028-01-31" }), context(user.id));

    // Mismo autor, producto y centro, pero la fila del CSV pide otra garantia o otro estado: no es esa fila.
    await expect(
      createAssetForImportRow(resolved({ ...base, warrantyExpiresAt: "2029-06-30" }), context(user.id, { mayAdopt: true })),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createAssetForImportRow(resolved({ ...base, warrantyExpiresAt: "2028-01-31", statusCode: "SUPPORT" }), context(user.id, { mayAdopt: true })),
    ).rejects.toBeInstanceOf(ConflictError);
    // La misma fila si se adopta.
    await expect(
      createAssetForImportRow(resolved({ ...base, warrantyExpiresAt: "2028-01-31" }), context(user.id, { mayAdopt: true })),
    ).resolves.toMatchObject({ adopted: true });
  });

  it("tolera un desfase de reloj de hasta un minuto entre la replica que inicio la carga y la que creo el activo", async () => {
    const { costCenter, product } = await createCatalog();
    const { user } = await createHolder();
    const row = resolved({ serialNumber: "SN-SKEW", productId: String(product._id), costCenterId: costCenter.id });
    await createAssetForImportRow(row, context(user.id));

    // El trabajo "empezo" 30 s DESPUES de crearse el activo (reloj adelantado en la replica que lo inicio): se adopta.
    await expect(
      createAssetForImportRow(row, context(user.id, { mayAdopt: true, jobStartedAt: new Date(Date.now() + 30_000) })),
    ).resolves.toMatchObject({ adopted: true });
  });

  it("dos altas simultaneas de la misma serie crean un solo activo", async () => {
    const { costCenter, product } = await createCatalog();
    const { user } = await createHolder();
    const row = resolved({ serialNumber: "SN-RACE", productId: String(product._id), costCenterId: costCenter.id });

    const outcomes = await Promise.allSettled([
      createAssetForImportRow(row, context(user.id)),
      createAssetForImportRow(row, context(user.id)),
      createAssetForImportRow(row, context(user.id)),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await AssetModel.count({ where: { serialNumber: "SN-RACE" } })).toBe(1);
  });
});
