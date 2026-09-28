import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response as ExpressResponse } from "express";
import { Op } from "sequelize";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../api";
import { resetTestData } from "../../test/setupIntegration";
import { signAccessToken } from "../library/jwt";
import { PermissionModel, type PermissionAction } from "../models/postgres/permission.model";
import { RoleModel } from "../models/postgres/role.model";
import { createPerson } from "../services/mssql/person.service";
import { createUser } from "../services/mssql/user.service";
import { createRole, getRoleByName } from "../services/postgres/role.service";
import { setRolePermissions } from "../services/postgres/permission.service";

// Auditoria de seguridad run-2 (2026-09-24), F1 y F3: un rol no-admin con
// pantallas delegables (Nuevo Ingreso, Modificar Permisos, Permisos de
// Pantalla) no puede otorgarse a si mismo, ni a una cuenta que crea, mas de
// lo que ya tiene. Levanta la app real con un JWT firmado localmente.
const PREFIX = "test-esc-";
let seq = 0;
let server: Server;
let baseUrl: string;

const RESET_TABLES = { mssql: ["users", "persons"] };

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
  await resetTestData(RESET_TABLES);
  await RoleModel.destroy({ where: { name: { [Op.like]: `${PREFIX}%` } } });
  await RoleModel.destroy({ where: { name: { [Op.like]: `1110-${PREFIX}%` } } });
});

async function permissionId(key: string): Promise<number> {
  const [resource, action] = key.split(":");
  const permission = await PermissionModel.findOne({ where: { resource, action: action as PermissionAction } });
  if (!permission) throw new Error(`Falta el permiso sembrado ${key}`);
  return permission.id;
}

async function roleWith(keys: string[]) {
  const role = await createRole({ name: `${PREFIX}${++seq}` });
  await setRolePermissions(role.id, await Promise.all(keys.map(permissionId)));
  return role;
}

async function newPerson() {
  const id = ++seq;
  return createPerson({
    firstName: "Test",
    lastName: `Esc${id}`,
    documentId: `TESTDOC-ESC${id}`,
    email: `test-esc-${id}@example.com`,
  });
}

async function tokenFor(role: RoleModel) {
  const person = await newPerson();
  const user = await createUser({ personId: person.id, roleId: role.id, username: `testesc${++seq}` });
  return signAccessToken({ sub: user.id, personId: person.id, username: user.username, roleId: role.id, roleName: role.name });
}

async function api(path: string, token: string, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("escalada de privilegios (auditoria run-2)", () => {
  it("F1: con users:create no se crea una cuenta admin ni con un rol mas amplio que el propio", async () => {
    const hr = await roleWith(["users:create", "persons:create"]);
    const token = await tokenFor(hr);
    const admin = await getRoleByName("admin");
    const wider = await roleWith(["users:create", "persons:create", "users:update"]);
    const narrower = await roleWith(["persons:create"]);

    const body = (roleId: number) => ({ personId: 0, roleId, username: `testesc${++seq}` });
    const person = await newPerson();
    expect((await api("/users", token, "POST", { ...body(admin!.id), personId: person.id })).status).toBe(403);
    expect((await api("/users", token, "POST", { ...body(wider.id), personId: person.id })).status).toBe(403);
    expect((await api("/users", token, "POST", { ...body(narrower.id), personId: person.id })).status).toBe(201);
  });

  it("R1: con users:update no se resetea la password ni se desactiva una cuenta admin", async () => {
    const token = await tokenFor(await roleWith(["users:update", "users:delete"]));
    const admin = await getRoleByName("admin");
    const person = await newPerson();
    const adminUser = await createUser({ personId: person.id, roleId: admin!.id, username: `testesc${++seq}` });

    expect((await api(`/users/${adminUser.id}/password`, token, "PATCH", { password: "Otra-Clave-2026!" })).status).toBe(403);
    expect((await api(`/users/${adminUser.id}`, token, "PATCH", { username: `testesc${++seq}` })).status).toBe(403);
    expect((await api(`/users/${adminUser.id}`, token, "DELETE")).status).toBe(403);
  });

  it("F1: con employees:create no se crea un cargo con el rol admin", async () => {
    const token = await tokenFor(await roleWith(["employees:create"]));
    const admin = await getRoleByName("admin");
    const res = await api("/positions", token, "POST", {
      title: "Cargo de prueba",
      description: "Intento de escalada",
      responsibilities: ["Nada"],
      roleId: admin!.id,
    });
    expect(res.status).toBe(403);
  });

  it("F3: con permissions:update no se amplia el propio rol ni se otorga lo que no se tiene", async () => {
    const manager = await roleWith(["permissions:update", "roles:read"]);
    const token = await tokenFor(manager);
    const other = await roleWith([]);
    const usersUpdate = await permissionId("users:update");
    const rolesRead = await permissionId("roles:read");

    // Su propio rol: nunca.
    expect((await api(`/roles/${manager.id}/permissions`, token, "POST", { permissionId: usersUpdate })).status).toBe(403);
    expect((await api(`/roles/${manager.id}/permissions`, token, "PUT", { permissionIds: [usersUpdate] })).status).toBe(403);
    // Otro rol: solo lo que el mismo tiene.
    expect((await api(`/roles/${other.id}/permissions`, token, "POST", { permissionId: usersUpdate })).status).toBe(403);
    expect((await api(`/roles/${other.id}/permissions`, token, "POST", { permissionId: rolesRead })).status).toBe(201);
    // El rol admin: nunca.
    const admin = await getRoleByName("admin");
    expect((await api(`/roles/${admin!.id}/permissions/${rolesRead}`, token, "DELETE")).status).toBe(403);
  });

  it("F3: no se amplia una pantalla que el propio rol tiene, ni se incluye lo que no se tiene", async () => {
    const bundleId = await permissionId("access-permission-management:access");
    const manager = await roleWith(["access-permission-management:access"]);
    const token = await tokenFor(manager);
    const usersUpdate = await permissionId("users:update");

    // Su propia pantalla: ni agregar ni quitar.
    expect((await api(`/permissions/${bundleId}/includes`, token, "POST", { permissionId: usersUpdate })).status).toBe(403);
    // Otra pantalla: no puede incluir un permiso que no tiene.
    const otherBundle = await permissionId("asset-labels:access");
    expect((await api(`/permissions/${otherBundle}/includes`, token, "POST", { permissionId: usersUpdate })).status).toBe(403);
  });

  it("revision 2026-09-28 M1: el prefijo de Sistemas (1110) y el propio rol solo los toca un administrador", async () => {
    const manager = await roleWith(["roles:create", "roles:update", "roles:read"]);
    const token = await tokenFor(manager);
    const other = await roleWith([]);

    // Crear un rol de Sistemas o renombrar uno a 1110-: no.
    expect((await api("/roles", token, "POST", { name: `1110-${PREFIX}${++seq}` })).status).toBe(403);
    expect((await api(`/roles/${other.id}`, token, "PUT", { name: `1110-${PREFIX}${++seq}` })).status).toBe(403);
    // Su propio rol: ni siquiera sin tocar el prefijo.
    expect((await api(`/roles/${manager.id}`, token, "PUT", { name: `${PREFIX}${++seq}` })).status).toBe(403);
    // Otro rol sin prefijo de Sistemas: si.
    expect((await api(`/roles/${other.id}`, token, "PUT", { name: `${PREFIX}${++seq}` })).status).toBe(200);
    expect((await api("/roles", token, "POST", { name: `${PREFIX}${++seq}` })).status).toBe(201);

    // Un rol de Sistemas ya creado por un admin no se renombra fuera de 1110 sin ser admin.
    const systems = await createRole({ name: `1110-${PREFIX}${++seq}` });
    expect((await api(`/roles/${systems.id}`, token, "PUT", { name: `${PREFIX}${++seq}` })).status).toBe(403);
  });
});
