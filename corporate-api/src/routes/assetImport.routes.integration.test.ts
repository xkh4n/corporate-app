import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response as ExpressResponse } from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../api";
import { resetTestData } from "../../test/setupIntegration";
import { redis } from "../databases/redis/connection";
import { signAccessToken } from "../library/jwt";
import { AssetModel } from "../models/postgres/asset.model";
import { PermissionModel } from "../models/postgres/permission.model";
import { RoleModel } from "../models/postgres/role.model";
import { RolePermissionModel } from "../models/postgres/rolePermission.model";
import { createPerson } from "../services/mssql/person.service";
import { createUser } from "../services/mssql/user.service";
import { createProduct } from "../services/mongo/product.service";
import { createProductCategory } from "../services/mongo/productCategory.service";
import { addRolePermission } from "../services/postgres/permission.service";
import { createRole, getRoleByName } from "../services/postgres/role.service";
import { createCostCenter } from "../services/postgres/costCenter.service";

// Capa HTTP de la carga masiva de activos por CSV: ruteo, permisos, propiedad de la carga, la subida multipart y su
// contenido. La logica de negocio y la reanudacion las cubren assetImport.service / assetImportJob.service. Levanta la
// app real en un puerto efimero con un JWT Bearer firmado localmente (mismo patron que assetReturn.routes...).
let seq = 0;
let server: Server;
let baseUrl: string;
const createdRoleIds: number[] = [];

const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: ["asset_movement_users", "asset_movements", "asset_kardex_entries", "assets", "cost_centers"],
  mongo: ["Product", "ProductCategory"],
};

const HEADER = "serial_number,product,category,cost_center_code,status,assigned_username,assigned_rut,warranty_expires_at";

async function clearImportKeys(): Promise<void> {
  for await (const batch of redis.scanIterator({ MATCH: "imp:*", COUNT: 100 })) {
    const keys = Array.isArray(batch) ? batch : [batch];
    if (keys.length > 0) await redis.del(keys);
  }
}

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
  await clearImportKeys();
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  await clearImportKeys();
  await resetTestData(RESET_TABLES);
  if (createdRoleIds.length > 0) {
    await RolePermissionModel.destroy({ where: { roleId: createdRoleIds } });
    await RoleModel.destroy({ where: { id: createdRoleIds } });
    createdRoleIds.length = 0;
  }
});

// roleName "admin" (bypass), "user" (sin permisos de asset-imports) o "importer" (rol propio con read+create).
async function createTokenFor(kind: "admin" | "user" | "importer" | "creator" | "reader") {
  let roleId: number;
  let roleName: string;
  if (kind === "importer" || kind === "creator" || kind === "reader") {
    const role = await createRole({ name: `import-test-${++seq}` });
    createdRoleIds.push(role.id);
    const actions = kind === "importer" ? ["read", "create"] : kind === "creator" ? ["create"] : ["read"];
    for (const permission of await PermissionModel.findAll({ where: { resource: "asset-imports" } })) {
      if (actions.includes(permission.action)) await addRolePermission(role.id, permission.id);
    }
    roleId = role.id;
    roleName = role.name;
  } else {
    const role = await getRoleByName(kind);
    if (!role) throw new Error(`Falta el rol "${kind}" sembrado`);
    roleId = role.id;
    roleName = kind;
  }
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `HttpImp${id}`,
    documentId: `TESTDOC-HTTPIMP${id}`,
    email: `test-http-imp-${id}@example.com`,
  });
  const user = await createUser({ personId: person.id, roleId, username: `testhttpimp${id}` });
  const token = signAccessToken({ sub: user.id, personId: person.id, username: user.username, roleId, roleName });
  return { user, token };
}

async function createCatalog() {
  const costCenter = await createCostCenter({ code: 72000 + ++seq, name: "Centro HTTP import" });
  const category = await createProductCategory({ name: `Categoria HTTP import ${++seq}` });
  const product = await createProduct({ name: `Producto HTTP import ${++seq}`, productType: "COMPRA", categoryId: String(category._id) });
  return { costCenter, product };
}

function csvOf(lines: string[]): string {
  return [HEADER, ...lines].join("\n");
}

async function api(path: string, token: string | null, method = "GET") {
  return fetch(`${baseUrl}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

async function uploadCsv(token: string, content: string | Uint8Array, mimetype = "text/csv", path = "/asset-imports") {
  const form = new FormData();
  form.append("file", new Blob([typeof content === "string" ? content : new Uint8Array(content)], { type: mimetype }), "carga.csv");
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function envelope(res: Response): Promise<{ codigo: number; message: string; data: any }> {
  return (await res.json()) as { codigo: number; message: string; data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function waitForDone(jobId: string, token: string) {
  const deadline = Date.now() + 25_000;
  for (;;) {
    const { data } = await envelope(await api(`/asset-imports/${jobId}`, token));
    if (data.meta.status === "DONE") return data;
    if (Date.now() > deadline) throw new Error(`La carga no termino: ${JSON.stringify(data.meta)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("autenticacion y permisos", () => {
  it("sin token responde 401", async () => {
    expect((await api("/asset-imports/00000000-0000-4000-8000-000000000001", null)).status).toBe(401);
    expect((await api("/asset-imports", null, "POST")).status).toBe(401);
  });

  it("un rol sin permisos de asset-imports recibe 403 en cada operacion", async () => {
    const { token } = await createTokenFor("user");
    const id = "00000000-0000-4000-8000-000000000001";
    expect((await uploadCsv(token, csvOf(["A,B,,1,,,,"]))).status).toBe(403);
    expect((await api(`/asset-imports/${id}`, token)).status).toBe(403);
    expect((await api(`/asset-imports/${id}/result`, token)).status).toBe(403);
    expect((await api(`/asset-imports/${id}/start`, token, "POST")).status).toBe(403);
    expect((await api(`/asset-imports/${id}/resume`, token, "POST")).status).toBe(403);
    expect((await api(`/asset-imports/${id}/cancel`, token, "POST")).status).toBe(403);
  });

  it("el permiso no basta: una carga ajena responde 404 (igual que una inexistente) aunque el rol tenga read y create", async () => {
    const owner = await createTokenFor("importer");
    const stranger = await createTokenFor("importer");
    const { costCenter, product } = await createCatalog();
    const created = await envelope(await uploadCsv(owner.token, csvOf([`SN-1,${product.name},,${costCenter.code},,,,`])));
    const jobId = created.data.jobId as string;

    // 404 y no 403: un tercero no puede distinguir "existe pero no es mia" de "no existe".
    const missing = await api("/asset-imports/00000000-0000-4000-8000-00000000dead", stranger.token);
    const foreign = await api(`/asset-imports/${jobId}`, stranger.token);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect((await api(`/asset-imports/${jobId}/result`, stranger.token)).status).toBe(404);
    expect((await api(`/asset-imports/${jobId}/start`, stranger.token, "POST")).status).toBe(404);
    expect((await api(`/asset-imports/${jobId}/cancel`, stranger.token, "POST")).status).toBe(404);
    expect((await api(`/asset-imports/${jobId}`, owner.token)).status).toBe(200);
  });

  it("un rol con solo create puede validar, iniciar y consultar su propia carga (los GET aceptan read o create)", async () => {
    const creator = await createTokenFor("creator");
    const { costCenter, product } = await createCatalog();
    const created = await uploadCsv(creator.token, csvOf([`SN-CR,${product.name},,${costCenter.code},,,,`]));
    expect(created.status).toBe(201);
    const { jobId } = (await envelope(created)).data;
    expect((await api(`/asset-imports/${jobId}`, creator.token)).status).toBe(200);
    expect((await api(`/asset-imports/${jobId}/result`, creator.token)).status).toBe(200);
  });

  it("un rol con solo read puede consultar pero no subir ni iniciar", async () => {
    const owner = await createTokenFor("importer");
    const reader = await createTokenFor("reader");
    const { costCenter, product } = await createCatalog();
    const { jobId } = (await envelope(await uploadCsv(owner.token, csvOf([`SN-RD,${product.name},,${costCenter.code},,,,`])))).data;

    expect((await uploadCsv(reader.token, csvOf(["A,B,,1,,,,"]))).status).toBe(403);
    expect((await api(`/asset-imports/${jobId}/start`, reader.token, "POST")).status).toBe(403);
    // Puede consultar (tiene read) pero la carga es de otro usuario: 404.
    expect((await api(`/asset-imports/${jobId}`, reader.token)).status).toBe(404);
  });
});

describe("flujo por HTTP", () => {
  it("sube el CSV, lo valida, inicia la carga, consulta el estado y descarga el resultado", async () => {
    const { token } = await createTokenFor("importer");
    const { costCenter, product } = await createCatalog();
    const lines = ["SN-H-1", "SN-H-2", "SN-H-3"].map((serial) => `${serial},${product.name},,${costCenter.code},,,,`);

    const created = await uploadCsv(token, csvOf(lines));
    expect(created.status).toBe(201);
    const report = (await envelope(created)).data;
    expect(report).toMatchObject({ totalRows: 3, validRows: 3, invalidRows: 0, issues: [] });
    expect(await AssetModel.count()).toBe(0); // validar no escribe

    const started = await api(`/asset-imports/${report.jobId}/start`, token, "POST");
    expect(started.status).toBe(202);
    const done = await waitForDone(report.jobId, token);
    expect(done.meta).toMatchObject({ ok: 3, failed: 0, cursor: 3 });
    expect(await AssetModel.count()).toBe(3);

    const result = await api(`/asset-imports/${report.jobId}/result`, token);
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toContain("text/csv");
    expect(result.headers.get("content-disposition")).toBe(`attachment; filename="resultado-carga-${report.jobId}.csv"`);
    const bytes = new Uint8Array(await result.arrayBuffer());
    // BOM UTF-8 para que Excel lea bien los acentos (text() lo descartaria al decodificar).
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(body.startsWith("﻿fila,serie,resultado,tag,detalle")).toBe(true);
    expect(body.match(/,OK,ACT\d{9},/g)).toHaveLength(3);
  });

  it("un archivo con errores responde 201 con el detalle por fila y start exige skipInvalid=true", async () => {
    const { token } = await createTokenFor("importer");
    const { costCenter, product } = await createCatalog();
    const created = await uploadCsv(token, csvOf([`SN-OK,${product.name},,${costCenter.code},,,,`, `SN-MAL,Inexistente,,${costCenter.code},,,,`]));
    expect(created.status).toBe(201);
    const report = (await envelope(created)).data;
    expect(report).toMatchObject({ validRows: 1, invalidRows: 1 });
    expect(report.issues).toEqual([expect.objectContaining({ row: 3, column: "product" })]);

    expect((await api(`/asset-imports/${report.jobId}/start`, token, "POST")).status).toBe(400);
    expect((await api(`/asset-imports/${report.jobId}/start?skipInvalid=true`, token, "POST")).status).toBe(202);
    await waitForDone(report.jobId, token);
    expect(await AssetModel.count()).toBe(1);
  });

  it("cancelar una carga validada la deja CANCELLED y no se puede iniciar", async () => {
    const { token } = await createTokenFor("importer");
    const { costCenter, product } = await createCatalog();
    const report = (await envelope(await uploadCsv(token, csvOf([`SN-C,${product.name},,${costCenter.code},,,,`])))).data;

    const cancelled = await api(`/asset-imports/${report.jobId}/cancel`, token, "POST");
    expect(cancelled.status).toBe(200);
    expect((await envelope(cancelled)).data.status).toBe("CANCELLED");
    expect((await api(`/asset-imports/${report.jobId}/start`, token, "POST")).status).toBe(409);
    expect(await AssetModel.count()).toBe(0);
  });

  it("un id que no es un UUID responde 400 y uno inexistente 404", async () => {
    const { token } = await createTokenFor("importer");
    expect((await api("/asset-imports/no-es-un-uuid", token)).status).toBe(400);
    expect((await api("/asset-imports/00000000-0000-4000-8000-00000000dead", token)).status).toBe(404);
  });
});

describe("subida del archivo", () => {
  it("acepta los tipos que declaran los clientes para un CSV (Windows manda application/vnd.ms-excel)", async () => {
    const { token } = await createTokenFor("importer");
    const { costCenter, product } = await createCatalog();
    const content = csvOf([`SN-T,${product.name},,${costCenter.code},,,,`]);
    for (const mimetype of ["text/csv", "application/vnd.ms-excel", "text/plain"]) {
      expect((await uploadCsv(token, content, mimetype)).status).toBe(201);
    }
  });

  it("rechaza un tipo que no es CSV, un binario disfrazado y un CSV sin la cabecera esperada", async () => {
    const { token } = await createTokenFor("importer");
    expect((await uploadCsv(token, "%PDF-1.4 x", "application/pdf")).status).toBe(400);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    expect((await uploadCsv(token, png, "text/csv")).status).toBe(400);
    expect((await uploadCsv(token, new Uint8Array([0xff, 0xfe, 0xfd, 0x73, 0x65, 0x72]), "text/csv")).status).toBe(400);
    expect((await uploadCsv(token, "a,b,c\n1,2,3", "text/csv")).status).toBe(400);
  });

  it("un CSV en ANSI (Excel en espanol) recibe un mensaje que indica guardar como CSV UTF-8", async () => {
    const { token } = await createTokenFor("importer");
    // "serial_number,producto\nñ" en Windows-1252: el byte 0xF1 no es UTF-8 valido.
    const ansi = new Uint8Array([...Buffer.from("serial_number,producto\n", "latin1"), 0xf1]);
    const res = await uploadCsv(token, ansi, "text/csv");
    expect(res.status).toBe(400);
    expect((await envelope(res)).message).toContain("UTF-8");
  });

  it("rechaza un archivo de mas de 2 MB y una solicitud sin archivo", async () => {
    const { token } = await createTokenFor("importer");
    const big = `${HEADER}\n${"SN-X,P,,1,,,,\n".repeat(200_000)}`;
    expect(big.length).toBeGreaterThan(2 * 1024 * 1024);
    expect((await uploadCsv(token, big)).status).toBe(400);
    expect((await api("/asset-imports", token, "POST")).status).toBe(400);
  });

  it("rechaza con 400 un archivo de estructura invalida y explica por que", async () => {
    const { token } = await createTokenFor("importer");
    const unknownColumn = await uploadCsv(token, "serial_number,product,cost_center_code,value\nSN-1,P,1,10");
    expect(unknownColumn.status).toBe(400);
    expect((await envelope(unknownColumn)).message).toContain("Columna desconocida");
    const unclosed = await uploadCsv(token, `${HEADER}\n"SN-1,P,,1,,,,`);
    expect(unclosed.status).toBe(400);
  });

  it("text/csv no se acepta en las demas rutas de subida", async () => {
    const { token } = await createTokenFor("admin");
    const res = await uploadCsv(token, csvOf(["SN,P,,1,,,,"]), "text/csv", "/goods-receipts/1/attachment");
    expect(res.status).toBe(400);
    expect((await envelope(res)).message).toContain("Tipo de archivo no permitido");
  });
});
