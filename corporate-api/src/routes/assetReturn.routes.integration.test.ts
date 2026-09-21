import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response as ExpressResponse } from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../api";
import { buildJavaScriptPdf, buildTestPdf, qpdfAvailable } from "../../test/pdfFixtures";
import { resetTestData } from "../../test/setupIntegration";
import { signAccessToken } from "../library/jwt";
import { getAssetReturnsFolder } from "../library/documentStorage";
import { createPerson } from "../services/mssql/person.service";
import { createUser } from "../services/mssql/user.service";
import { getRoleByName } from "../services/postgres/role.service";
import { createCostCenter } from "../services/postgres/costCenter.service";
import { createProduct } from "../services/mongo/product.service";
import { createProductCategory } from "../services/mongo/productCategory.service";
import { createAssetsFromReceipt } from "../services/postgres/asset.service";
import { assignAssetToUser } from "../services/postgres/assetMovement.service";

// Capa HTTP de las devoluciones de activos: ruteo, validacion Zod, permisos, la
// subida multipart de la guia y su descarga. La logica de negocio ya la cubre
// assetReturn.service.integration.test.ts. Levanta la app real en un puerto
// efimero con un JWT Bearer firmado localmente (ver inventoryCount.routes...).
let seq = 0;
let server: Server;
let baseUrl: string;

const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: [
    "asset_return_lines",
    "asset_returns",
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

// Archivos que el test dejo en uploads/devoluciones: se borran al terminar.
const writtenCodes = new Set<string>();

beforeAll(async () => {
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
  for (const code of writtenCodes) fs.rmSync(path.join(getAssetReturnsFolder(), `${code}.pdf`), { force: true });
  writtenCodes.clear();
  await resetTestData(RESET_TABLES);
});

async function createTokenFor(roleName: "admin" | "user") {
  const role = await getRoleByName(roleName);
  if (!role) throw new Error(`Falta el rol "${roleName}" sembrado`);
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `HttpAR${id}`,
    documentId: `TESTDOC-HTTPAR${id}`,
    email: `test-http-ar-${id}@example.com`,
  });
  const user = await createUser({ personId: person.id, roleId: role.id, username: `testhttpar${id}` });
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

async function uploadDocument(id: number, token: string, content: string | Buffer, mimetype = "application/pdf") {
  const form = new FormData();
  form.append("file", new Blob([typeof content === "string" ? content : new Uint8Array(content)], { type: mimetype }), "guia.pdf");
  return fetch(`${baseUrl}/asset-returns/${id}/document`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function envelope(res: Response): Promise<{ data: any }> {
  return (await res.json()) as { data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function createAssignedAssets(count: number) {
  const { user: holder } = await createTokenFor("user");
  const costCenter = await createCostCenter({ code: 55000 + ++seq, name: "Centro HTTP AR" });
  const category = await createProductCategory({ name: `Categoria HTTP AR${++seq}` });
  const product = await createProduct({
    name: `Producto HTTP AR${++seq}`,
    productType: "COMPRA",
    categoryId: String(category._id),
  });
  const assets = await createAssetsFromReceipt({
    goodsReceiptId: 980000 + ++seq,
    productId: String(product._id),
    quantity: count,
    costCenterId: costCenter.id,
    serialNumbers: Array.from({ length: count }, (_, i) => `SN-HTTP-AR-${seq}-${i}`),
    finalStatusCode: "AVAILABLE",
  });
  for (const asset of assets) await assignAssetToUser({ assetId: asset.id, userId: holder.id });
  return { costCenter, assets };
}

describe("autenticacion y permisos", () => {
  it("sin token responde 401", async () => {
    expect((await api("/asset-returns", null)).status).toBe(401);
  });

  it("un rol sin permisos de asset-returns recibe 403 en cada operacion", async () => {
    const { token } = await createTokenFor("user");
    expect((await api("/asset-returns", token)).status).toBe(403);
    expect((await api("/asset-returns/candidates?costCenterId=1", token)).status).toBe(403);
    expect((await api("/asset-returns", token, { method: "POST", body: { costCenterId: 1, assetIds: [1] } })).status).toBe(403);
    expect((await api("/asset-returns/1", token)).status).toBe(403);
    expect((await api("/asset-returns/1/document", token)).status).toBe(403);
    expect((await api("/asset-returns/1/send", token, { method: "POST" })).status).toBe(403);
    expect((await api("/asset-returns/1/receive", token, { method: "POST", body: {} })).status).toBe(403);
    expect((await api("/asset-returns/1/cancel", token, { method: "POST" })).status).toBe(403);
  });
});

describe("validacion y errores", () => {
  it("400 con cuerpo invalido y 404/409 de negocio", async () => {
    const { token } = await createTokenFor("admin");
    const { costCenter, assets } = await createAssignedAssets(1);

    expect((await api("/asset-returns", token, { method: "POST", body: { costCenterId: costCenter.id, assetIds: [] } })).status).toBe(400);
    expect((await api("/asset-returns", token, { method: "POST", body: { costCenterId: costCenter.id, assetIds: [1, 1] } })).status).toBe(400);
    // Modo "otros" sin centro de costo, modo desconocido, y crear "otros" sin centro de costo -> 400.
    expect((await api("/asset-returns/candidates", token)).status).toBe(400);
    expect((await api(`/asset-returns/candidates?scope=NADA&costCenterId=${costCenter.id}`, token)).status).toBe(400);
    expect((await api("/asset-returns", token, { method: "POST", body: { assetIds: [assets[0]!.id] } })).status).toBe(400);
    expect((await api("/asset-returns", token, { method: "POST", body: { scope: "NADA", costCenterId: costCenter.id, assetIds: [assets[0]!.id] } })).status).toBe(400);
    // "Mis equipos" sin equipos propios: el admin no tiene ninguno asignado.
    expect((await envelope(await api("/asset-returns/candidates?scope=OWN", token))).data.items).toHaveLength(0);
    expect((await api("/asset-returns/abc", token)).status).toBe(400);
    expect((await api("/asset-returns/999999", token)).status).toBe(404);
    expect(
      (await api("/asset-returns", token, { method: "POST", body: { costCenterId: 999999, assetIds: [assets[0]!.id] } })).status,
    ).toBe(404);

    const created = await api("/asset-returns", token, { method: "POST", body: { costCenterId: costCenter.id, assetIds: [assets[0]!.id] } });
    expect(created.status).toBe(201);
    const id = (await envelope(created)).data.id as number;

    // El mismo activo en otra devolucion vigente -> 409.
    expect(
      (await api("/asset-returns", token, { method: "POST", body: { costCenterId: costCenter.id, assetIds: [assets[0]!.id] } })).status,
    ).toBe(409);
    // Enviar sin guia -> 400.
    expect((await api(`/asset-returns/${id}/send`, token, { method: "POST" })).status).toBe(400);
    // Recibir un borrador -> 409.
    expect((await api(`/asset-returns/${id}/receive`, token, { method: "POST", body: {} })).status).toBe(409);
    // Sin archivo -> 400; no PDF -> 400; contenido que no es PDF -> 400.
    expect((await api(`/asset-returns/${id}/document`, token, { method: "POST" })).status).toBe(400);
    expect((await uploadDocument(id, token, "x", "image/png")).status).toBe(400);
    expect((await uploadDocument(id, token, "esto no es un pdf")).status).toBe(400);
  });

  it.skipIf(!qpdfAvailable)("rechaza un PDF con contenido activo o que no se puede verificar (400)", async () => {
    const { token } = await createTokenFor("admin");
    const { costCenter, assets } = await createAssignedAssets(1);
    const created = await api("/asset-returns", token, {
      method: "POST",
      body: { costCenterId: costCenter.id, assetIds: [assets[0]!.id] },
    });
    const id = (await envelope(created)).data.id as number;
    expect((await uploadDocument(id, token, buildJavaScriptPdf())).status).toBe(400);
    // Empieza con %PDF- pero no es un PDF que qpdf pueda leer.
    expect((await uploadDocument(id, token, "%PDF-1.4 << /S /JavaScript /JS (app.alert(1)) >>")).status).toBe(400);
  });
});

describe.skipIf(!qpdfAvailable)("flujo completo por HTTP (admin)", () => {
  it("borrador -> guia -> imprimir -> enviar -> recibir parcial y total", async () => {
    const { token } = await createTokenFor("admin");
    const { costCenter, assets } = await createAssignedAssets(2);

    const candidates = await api(`/asset-returns/candidates?costCenterId=${costCenter.id}`, token);
    expect(candidates.status).toBe(200);
    expect((await envelope(candidates)).data.items).toHaveLength(2);

    const created = await api("/asset-returns", token, {
      method: "POST",
      body: { costCenterId: costCenter.id, assetIds: assets.map((asset) => asset.id), notes: "Recambio" },
    });
    expect(created.status).toBe(201);
    const draft = (await envelope(created)).data;
    expect(draft).toMatchObject({ status: "DRAFT", code: null, lineCount: 2 });

    // Guia: se guarda como <codigo>.pdf (la reescritura de qpdf) y se entrega como descarga.
    const uploaded = await uploadDocument(draft.id, token, buildTestPdf([], "", "Guia HTTP"));
    expect(uploaded.status).toBe(201);
    const { code, filename } = (await envelope(uploaded)).data as { code: string; filename: string };
    writtenCodes.add(code);
    expect(code).toMatch(new RegExp(`^DEV${costCenter.code}\\d{17}$`));
    expect(filename).toBe(`${code}.pdf`);

    const document = await api(`/asset-returns/${draft.id}/document`, token);
    expect(document.status).toBe(200);
    expect(document.headers.get("content-type")).toContain("application/pdf");
    expect(document.headers.get("content-disposition")).toBe(`attachment; filename="${filename}"`);
    expect((await document.text()).startsWith("%PDF-")).toBe(true);

    const sent = await api(`/asset-returns/${draft.id}/send`, token, { method: "POST" });
    expect(sent.status).toBe(200);
    const sentData = (await envelope(sent)).data;
    expect(sentData.status).toBe("SENT");
    expect(sentData.lines.map((line: { statusCode: string }) => line.statusCode)).toEqual(["MOVE_TO_RETURNED", "MOVE_TO_RETURNED"]);

    // Ya enviada: no se cancela ni se agrega nada.
    expect((await api(`/asset-returns/${draft.id}/cancel`, token, { method: "POST" })).status).toBe(409);

    const partial = await api(`/asset-returns/${draft.id}/receive`, token, {
      method: "POST",
      body: { lineIds: [sentData.lines[0].id] },
    });
    expect(partial.status).toBe(200);
    expect((await envelope(partial)).data).toMatchObject({ status: "SENT", receivedCount: 1 });

    const done = await api(`/asset-returns/${draft.id}/receive`, token, { method: "POST", body: {} });
    expect(done.status).toBe(200);
    expect((await envelope(done)).data).toMatchObject({ status: "RECEIVED", receivedCount: 2 });

    const list = await api("/asset-returns?status=RECEIVED", token);
    expect(list.status).toBe(200);
    const items = (await envelope(list)).data.items as { code: string }[];
    expect(items.map((item) => item.code)).toEqual([code]);
  });

  it("RETURNED y MOVE_TO_RETURNED no se pueden crear por la API generica de movimientos", async () => {
    const { token } = await createTokenFor("admin");
    const { assets } = await createAssignedAssets(1);
    for (const movementType of ["RETURNED", "MOVE_TO_RETURNED"]) {
      const res = await api("/asset-movements", token, { method: "POST", body: { assetId: assets[0]!.id, movementType } });
      expect(res.status).toBe(400);
    }
  });
});
