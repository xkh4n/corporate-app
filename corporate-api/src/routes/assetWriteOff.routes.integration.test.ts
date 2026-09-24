import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response as ExpressResponse } from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../api";
import { buildTestPdf, qpdfAvailable } from "../../test/pdfFixtures";
import { resetTestData } from "../../test/setupIntegration";
import { signAccessToken } from "../library/jwt";
import { getAssetWriteOffFolder } from "../library/documentStorage";
import { currentDate } from "../library/depreciation";
import { createPerson } from "../services/mssql/person.service";
import { createUser } from "../services/mssql/user.service";
import { getRoleByName } from "../services/postgres/role.service";
import { createCostCenter } from "../services/postgres/costCenter.service";
import { createProduct } from "../services/mongo/product.service";
import { createAssetsFromReceipt } from "../services/postgres/asset.service";
import { createAssetMovement } from "../services/postgres/assetMovement.service";
import { classify } from "../services/postgres/assetAccounting.service";

// Capa HTTP de la baja contable (plan 008): permisos, validacion Zod y los
// tipos de archivo de cada subida. Las reglas de negocio las cubre
// assetWriteOff.service.integration.test.ts.
let seq = 0;
let server: Server;
let baseUrl: string;
const createdWriteOffs = new Set<number>();

const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: [
    "asset_write_off_photos",
    "asset_write_off_lines",
    "asset_write_offs",
    "asset_accounting",
    "asset_movement_users",
    "asset_movements",
    "asset_kardex_entries",
    "assets",
    "cost_centers",
  ],
  mongo: ["Product"],
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

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
  for (const id of createdWriteOffs) fs.rmSync(getAssetWriteOffFolder(id), { recursive: true, force: true });
  createdWriteOffs.clear();
  await resetTestData(RESET_TABLES);
});

async function createTokenFor(roleName: "admin" | "user") {
  const role = await getRoleByName(roleName);
  if (!role) throw new Error(`Falta el rol "${roleName}" sembrado`);
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `HttpWO${id}`,
    documentId: `TESTDOC-HTTPWO${id}`,
    email: `test-http-wo-${id}@example.com`,
  });
  const user = await createUser({ personId: person.id, roleId: role.id, username: `testhttpwo${id}` });
  return signAccessToken({ sub: user.id, personId: person.id, username: user.username, roleId: role.id, roleName });
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

async function upload(path: string, token: string, content: Buffer, mimetype: string) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(content)], { type: mimetype }), "archivo");
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
}

async function decommissionedExpenseAsset() {
  const costCenter = await createCostCenter({ code: 68000 + ++seq, name: "Centro HTTP WO" });
  const product = await createProduct({ name: `Producto HTTP WO${++seq}`, productType: "COMPRA" });
  const [asset] = await createAssetsFromReceipt({
    goodsReceiptId: 992000 + ++seq,
    productId: String(product._id),
    quantity: 1,
    costCenterId: costCenter.id,
    serialNumbers: [`SN-HTTP-WO-${seq}`],
    value: "100.00",
    finalStatusCode: "AVAILABLE",
  });
  await classify(asset!.id, { classification: "EXPENSE" }, 1);
  await createAssetMovement({ assetId: asset!.id, movementType: "DECOMMISSIONED" });
  return asset!;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function envelope(res: Response): Promise<{ data: any }> {
  return (await res.json()) as { data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe("baja contable: permisos y archivos", () => {
  it("sin token 401 y un rol sin permisos recibe 403 en cada operacion", async () => {
    expect((await api("/asset-write-offs", null)).status).toBe(401);
    const token = await createTokenFor("user");
    expect((await api("/asset-write-offs", token)).status).toBe(403);
    expect((await api("/asset-write-offs/eligible", token)).status).toBe(403);
    expect((await api("/asset-write-offs", token, { method: "POST", body: { assetIds: [1] } })).status).toBe(403);
    expect((await api("/asset-write-offs/1", token)).status).toBe(403);
    expect((await api("/asset-write-offs/1/certificate", token)).status).toBe(403);
    expect((await api("/asset-write-offs/1/photos/1", token)).status).toBe(403);
    expect((await upload("/asset-write-offs/1/assets/1/photos", token, PNG, "image/png")).status).toBe(403);
    expect((await api("/asset-write-offs/1/confirm", token, { method: "POST" })).status).toBe(403);
  });

  it("valida el cuerpo y rechaza tipos de archivo cruzados", async () => {
    const token = await createTokenFor("admin");
    const asset = await decommissionedExpenseAsset();

    expect((await api("/asset-write-offs", token, { method: "POST", body: { assetIds: [] } })).status).toBe(400);
    expect((await api("/asset-write-offs", token, { method: "POST", body: { assetIds: [asset.id], extra: 1 } })).status).toBe(400);
    expect((await api("/asset-write-offs/abc", token)).status).toBe(400);

    const created = await api("/asset-write-offs", token, { method: "POST", body: { assetIds: [asset.id] } });
    expect(created.status).toBe(201);
    const id = (await envelope(created)).data.id as number;
    createdWriteOffs.add(id);

    expect((await api(`/asset-write-offs/${id}`, token, { method: "PUT", body: { writeOffDate: "2025-13-01" } })).status).toBe(400);

    // Foto: un PDF (o un PNG falso) no pasa; el certificado: un PNG no pasa.
    const photoPath = `/asset-write-offs/${id}/assets/${asset.id}/photos`;
    expect((await upload(photoPath, token, buildTestPdf(), "application/pdf")).status).toBe(400);
    expect((await upload(photoPath, token, Buffer.from("no es png"), "image/png")).status).toBe(400);
    expect((await upload(`/asset-write-offs/${id}/certificate`, token, PNG, "image/png")).status).toBe(400);
    // Foto de un activo que no es parte de la baja: 404 antes de recibir el archivo.
    expect((await upload(`/asset-write-offs/${id}/assets/999999/photos`, token, PNG, "image/png")).status).toBe(404);

    const uploaded = await upload(photoPath, token, PNG, "image/png");
    expect(uploaded.status).toBe(201);
    const photoId = (await envelope(uploaded)).data.id as number;
    const served = await api(`/asset-write-offs/${id}/photos/${photoId}`, token);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it.skipIf(!qpdfAvailable)("flujo completo por HTTP: certificado saneado, confirmar y descargar", async () => {
    const token = await createTokenFor("admin");
    const asset = await decommissionedExpenseAsset();
    const id = (await envelope(await api("/asset-write-offs", token, { method: "POST", body: { assetIds: [asset.id] } })))
      .data.id as number;
    createdWriteOffs.add(id);

    const put = await api(`/asset-write-offs/${id}`, token, {
      method: "PUT",
      body: { writeOffDate: currentDate(), reason: "Fin de vida util", certificateNumber: "REP-123" },
    });
    expect(put.status).toBe(200);
    expect((await upload(`/asset-write-offs/${id}/certificate`, token, buildTestPdf(), "application/pdf")).status).toBe(201);
    expect((await upload(`/asset-write-offs/${id}/assets/${asset.id}/photos`, token, PNG, "image/png")).status).toBe(201);

    const confirmed = await api(`/asset-write-offs/${id}/confirm`, token, { method: "POST" });
    expect(confirmed.status).toBe(200);
    expect((await envelope(confirmed)).data.status).toBe("CONFIRMED");

    const download = await api(`/asset-write-offs/${id}/certificate`, token);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    // Confirmada: descartar o volver a confirmar -> 409.
    expect((await api(`/asset-write-offs/${id}`, token, { method: "DELETE" })).status).toBe(409);
    expect((await api(`/asset-write-offs/${id}/confirm`, token, { method: "POST" })).status).toBe(409);
  });
});
