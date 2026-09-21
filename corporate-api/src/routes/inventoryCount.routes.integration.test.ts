import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response as ExpressResponse } from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../api";
import { resetTestData } from "../../test/setupIntegration";
import { signAccessToken } from "../library/jwt";
import { createPerson } from "../services/mssql/person.service";
import { createUser } from "../services/mssql/user.service";
import { getRoleByName } from "../services/postgres/role.service";
import { createCostCenter } from "../services/postgres/costCenter.service";
import { createProduct } from "../services/mongo/product.service";
import { createProductCategory } from "../services/mongo/productCategory.service";
import { createAssetsFromReceipt } from "../services/postgres/asset.service";

// Capa HTTP de la toma de inventario: ruteo, validacion Zod, permisos y los
// archivos que descarga el navegador (PDF y etiquetas.txt). La logica de
// negocio ya la cubre inventoryCount.service.integration.test.ts. Levanta la
// app real en un puerto efimero, con un JWT Bearer firmado localmente (mismo
// camino que usan los clientes stateless, ver middlewares/authenticate.ts).
let seq = 0;
let server: Server;
let baseUrl: string;

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

beforeAll(async () => {
  // Sin sesion Redis: estos tests autentican solo con Bearer.
  const noSession = (_req: Request, _res: ExpressResponse, next: NextFunction) => next();
  const app = await createApp(noSession);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  await resetTestData(RESET_TABLES);
});

async function createTokenFor(roleName: "admin" | "user") {
  const role = await getRoleByName(roleName);
  if (!role) throw new Error(`Falta el rol "${roleName}" sembrado`);
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `HttpIC${id}`,
    documentId: `TESTDOC-HTTP${id}`,
    email: `test-http-ic-${id}@example.com`,
  });
  const user = await createUser({ personId: person.id, roleId: role.id, username: `testhttpic${id}` });
  const token = signAccessToken({
    sub: user.id,
    personId: person.id,
    username: user.username,
    roleId: role.id,
    roleName,
  });
  return { user, token };
}

async function api(path: string, token: string | null, init: { method?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

// Sobre estandar {codigo, message, data} de la API. data va sin tipar a
// proposito: cada test aserta solo los campos que le importan.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function envelope(res: Response): Promise<{ data: any }> {
  return (await res.json()) as { data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function createCatalog() {
  const costCenter = await createCostCenter({ code: 66000 + ++seq, name: "Centro HTTP IC" });
  const category = await createProductCategory({ name: `Categoria HTTP ${++seq}` });
  const product = await createProduct({
    name: `Producto HTTP ${++seq}`,
    productType: "COMPRA",
    categoryId: String(category._id),
  });
  return { costCenterId: costCenter.id, categoryId: String(category._id), productId: String(product._id) };
}

describe("autenticacion y permisos", () => {
  it("sin token responde 401", async () => {
    const res = await api("/inventory-counts", null);
    expect(res.status).toBe(401);
  });

  it("un rol sin permisos de inventory-counts recibe 403 al iniciar y al listar", async () => {
    const { token } = await createTokenFor("user");
    expect((await api("/inventory-counts/start", token, { method: "POST", body: {} })).status).toBe(403);
    expect((await api("/inventory-counts", token)).status).toBe(403);
    expect((await api("/inventory-counts/holders/lookup", token, { method: "POST", body: { documentId: "11111111-1" } })).status).toBe(403);
  });
});

describe("holders/lookup", () => {
  it("valida el RUT exacto y devuelve solo id y nombre; sin coincidencia parcial", async () => {
    const { token, user } = await createTokenFor("admin");
    const documentId = `TESTDOC-HTTP${seq}`;
    const found = await api("/inventory-counts/holders/lookup", token, { method: "POST", body: { documentId } });
    expect(found.status).toBe(200);
    const data = (await envelope(found)).data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(["fullName", "userId"]);
    expect(data.userId).toBe(user.id);

    // Un prefijo NO coincide (antes la busqueda era por LIKE y permitia enumerar personas).
    const partial = await api("/inventory-counts/holders/lookup", token, { method: "POST", body: { documentId: documentId.slice(0, -1) } });
    expect(partial.status).toBe(200);
    expect((await envelope(partial)).data).toBeNull();

    expect((await api("/inventory-counts/holders/lookup", token, { method: "POST", body: { documentId: "ab" } })).status).toBe(400);
  });
});

describe("parametros de las etiquetas y de paginacion", () => {
  it("rechaza medidas de etiqueta desmesuradas y un sortBy fuera de la lista cae al orden por defecto", async () => {
    const { token } = await createTokenFor("admin");
    const started = await api("/inventory-counts/start", token, { method: "POST", body: {} });
    const count = (await envelope(started)).data as { id: number };
    expect((await api(`/inventory-counts/${count.id}/labels.zpl?widthMm=1e308`, token)).status).toBe(400);
    // sortBy inexistente/no permitido: no revienta con 500, se ordena por defecto.
    expect((await api("/inventory-counts?sortBy=passwordHash", token)).status).toBe(200);
  });
});

describe("lookup", () => {
  it("rechaza un value demasiado largo con 400", async () => {
    const { token } = await createTokenFor("admin");
    const started = await api("/inventory-counts/start", token, { method: "POST", body: {} });
    const count = (await envelope(started)).data as { id: number };
    const res = await api(`/inventory-counts/${count.id}/lookup?by=SERIAL&value=${"x".repeat(101)}`, token);
    expect(res.status).toBe(400);
  });
});

describe("flujo completo por HTTP (admin)", () => {
  it("Inicio -> alta con tag nuevo -> Fin -> reporte, PDF y etiquetas.txt", async () => {
    const { token } = await createTokenFor("admin");
    const catalog = await createCatalog();

    const started = await api("/inventory-counts/start", token, { method: "POST", body: {} });
    expect(started.status).toBe(201);
    const count = (await envelope(started)).data as { id: number; number: string; resumed: boolean };
    expect(count.resumed).toBe(false);

    // Segundo Inicio del mismo usuario: se retoma la abierta (200, no 201).
    const resumed = await api("/inventory-counts/start", token, { method: "POST", body: {} });
    expect(resumed.status).toBe(200);
    expect((await envelope(resumed)).data.id).toBe(count.id);

    // Tag que no existe: lookup responde 200 con data null.
    const lookup = await api(`/inventory-counts/${count.id}/lookup?by=TAG&value=ACT999999999`, token);
    expect(lookup.status).toBe(200);
    expect((await envelope(lookup)).data).toBeNull();

    const added = await api(`/inventory-counts/${count.id}/lines`, token, {
      method: "POST",
      body: {
        lookupBy: "TAG",
        tag: "TAG-DESCONOCIDO",
        productCategoryId: catalog.categoryId,
        productId: catalog.productId,
        costCenterId: catalog.costCenterId,
        serialNumber: "SN-HTTP-1",
        statusCode: "DAMAGED",
      },
    });
    expect(added.status).toBe(201);
    const line = (await envelope(added)).data as { assetCreated: boolean; asset: { tag: string } };
    expect(line.assetCreated).toBe(true);
    expect(line.asset.tag).toMatch(/^ACT\d{9}$/);

    const lines = await api(`/inventory-counts/${count.id}/lines`, token);
    expect(lines.status).toBe(200);
    const listed = (await envelope(lines)).data.items as { tag: string; statusCode: string }[];
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ tag: line.asset.tag, statusCode: "DAMAGED" });

    const detail = await api(`/inventory-counts/${count.id}`, token);
    expect((await envelope(detail)).data).toMatchObject({ status: "OPEN", totalLines: 1, createdAssets: 1 });

    const closed = await api(`/inventory-counts/${count.id}/close`, token, { method: "POST" });
    expect(closed.status).toBe(200);
    const closedData = (await envelope(closed)).data as { status: string; createdAssetIds: number[] };
    expect(closedData.status).toBe("CLOSED");
    expect(closedData.createdAssetIds).toHaveLength(1);

    // Toma cerrada: no acepta mas equipos.
    const late = await api(`/inventory-counts/${count.id}/lines`, token, {
      method: "POST",
      body: {
        lookupBy: "SERIAL",
        productCategoryId: catalog.categoryId,
        productId: catalog.productId,
        costCenterId: catalog.costCenterId,
        serialNumber: "SN-HTTP-TARDE",
        statusCode: "AVAILABLE",
      },
    });
    expect(late.status).toBe(409);

    const report = await api(`/inventory-counts/${count.id}/report`, token);
    const reportData = (await envelope(report)).data;
    expect(reportData.summary).toMatchObject({ totalLines: 1, createdAssets: 1, missingAssets: 0 });

    const pdf = await api(`/inventory-counts/${count.id}/report.pdf`, token);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    expect(pdf.headers.get("content-disposition")).toContain(`inventario-${count.number}.pdf`);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");

    const labels = await api(`/inventory-counts/${count.id}/labels.zpl?widthMm=60&showBorder=false`, token);
    expect(labels.status).toBe(200);
    expect(labels.headers.get("content-disposition")).toContain('filename="etiquetas.txt"');
    const zpl = await labels.text();
    expect(zpl).toContain("^XA");
    expect(zpl).toContain(line.asset.tag);
    // showBorder=false debe respetarse (z.coerce.boolean() lo habria vuelto true).
    expect(zpl).not.toContain("^GB");
    expect(zpl).toContain("^PW480"); // 60 mm a 203 dpi
  });

  it("valida el body y los ids: 400 ante datos invalidos", async () => {
    const { token } = await createTokenFor("admin");
    const started = await api("/inventory-counts/start", token, { method: "POST", body: {} });
    const { id } = (await envelope(started)).data as { id: number };

    const badBody = await api(`/inventory-counts/${id}/lines`, token, {
      method: "POST",
      body: { productCategoryId: "corto", productId: "x", costCenterId: -1, statusCode: "OTRO" },
    });
    expect(badBody.status).toBe(400);

    // lookupBy TAG sin tag y lookupBy SERIAL sin serie: 400 (la validacion depende del modo).
    const base = {
      productCategoryId: "a".repeat(24),
      productId: "b".repeat(24),
      costCenterId: 1,
      statusCode: "AVAILABLE",
    };
    expect(
      (await api(`/inventory-counts/${id}/lines`, token, { method: "POST", body: { ...base, lookupBy: "TAG" } })).status,
    ).toBe(400);
    expect(
      (await api(`/inventory-counts/${id}/lines`, token, { method: "POST", body: { ...base, lookupBy: "SERIAL" } })).status,
    ).toBe(400);
    expect((await api(`/inventory-counts/${id}/lines`, token, { method: "POST", body: base })).status).toBe(400);

    expect((await api("/inventory-counts/abc", token)).status).toBe(400);
    expect((await api(`/inventory-counts/${id}/lookup`, token)).status).toBe(400);
    expect((await api(`/inventory-counts/${id}/lookup?by=OTRO&value=1`, token)).status).toBe(400);
    expect((await api(`/inventory-counts/${id}/lookup?by=TAG`, token)).status).toBe(400);
    expect((await api("/inventory-counts/999999", token)).status).toBe(404);
  });

  it("labels.zpl de una toma sin altas responde 400 (no hay nada que imprimir)", async () => {
    const { token } = await createTokenFor("admin");
    const started = await api("/inventory-counts/start", token, { method: "POST", body: {} });
    const { id } = (await envelope(started)).data as { id: number };
    await api(`/inventory-counts/${id}/close`, token, { method: "POST" });

    expect((await api(`/inventory-counts/${id}/labels.zpl`, token)).status).toBe(400);
  });
});

describe("filtro de productos por categoria", () => {
  it("GET /products?categoryId= devuelve solo los productos de esa categoria", async () => {
    const { token } = await createTokenFor("admin");
    const catalog = await createCatalog();
    const other = await createProductCategory({ name: `Otra categoria ${++seq}` });
    await createProduct({ name: `Producto otra ${++seq}`, productType: "COMPRA", categoryId: String(other._id) });

    const res = await api(`/products?categoryId=${catalog.categoryId}`, token);
    expect(res.status).toBe(200);
    const items = (await envelope(res)).data.items as { id: string }[];
    expect(items.map((item) => item.id)).toEqual([catalog.productId]);

    expect((await api("/products?categoryId=nope", token)).status).toBe(400);
  });
});

describe("valorizacion de activos (HTTP)", () => {
  async function createUnvaluedAsset(serial: string) {
    const catalog = await createCatalog();
    const [asset] = await createAssetsFromReceipt({
      goodsReceiptId: 970000 + ++seq,
      productId: catalog.productId,
      quantity: 1,
      costCenterId: catalog.costCenterId,
      serialNumbers: [serial],
      finalStatusCode: "AVAILABLE",
    });
    return asset!;
  }

  it("un rol sin asset-valuation recibe 403 al listar y al valorizar", async () => {
    const { token } = await createTokenFor("user");
    expect((await api("/asset-valuation", token)).status).toBe(403);
    const post = await api("/asset-valuation", token, { method: "POST", body: { items: [{ assetId: 1, value: 10 }] } });
    expect(post.status).toBe(403);
  });

  it("lista los pendientes, valoriza en lote y ya no los lista", async () => {
    const { token } = await createTokenFor("admin");
    const asset = await createUnvaluedAsset("SN-HTTP-VAL");

    const listed = await api("/asset-valuation", token);
    expect(listed.status).toBe(200);
    const pending = (await envelope(listed)).data.items as { id: number; tag: string }[];
    expect(pending.map((item) => item.id)).toEqual([asset.id]);

    const posted = await api("/asset-valuation", token, {
      method: "POST",
      body: { items: [{ assetId: asset.id, value: 250000 }, { assetId: 987654, value: 10 }] },
    });
    expect(posted.status).toBe(200);
    const results = (await envelope(posted)).data as { assetId: number; ok: boolean }[];
    expect(results.map((result) => result.ok)).toEqual([true, false]);

    const after = (await envelope(await api("/asset-valuation", token))).data.items as unknown[];
    expect(after).toHaveLength(0);
  });

  it("valida el lote: valor <= 0, lote vacio y activos repetidos responden 400", async () => {
    const { token } = await createTokenFor("admin");
    const post = (items: unknown) => api("/asset-valuation", token, { method: "POST", body: { items } });
    expect((await post([{ assetId: 1, value: 0 }])).status).toBe(400);
    expect((await post([{ assetId: 1, value: -5 }])).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post([{ assetId: 1, value: 5 }, { assetId: 1, value: 6 }])).status).toBe(400);
  });
});

describe("movimientos por la API generica", () => {
  it("DEVALUATED no se puede crear por POST /asset-movements (solo la toma de inventario)", async () => {
    const { token } = await createTokenFor("admin");
    const res = await api("/asset-movements", token, {
      method: "POST",
      body: { assetId: 1, movementType: "DEVALUATED", userIds: [1] },
    });
    expect(res.status).toBe(400);
  });
});
