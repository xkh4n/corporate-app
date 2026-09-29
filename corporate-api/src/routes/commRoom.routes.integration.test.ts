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
import { createCostCenter } from "../services/postgres/costCenter.service";
import { createRoom } from "../services/postgres/commRooms/commRoom.service";
import { setRolePermissions } from "../services/postgres/permission.service";
import { createRole } from "../services/postgres/role.service";

// Plan 016: cada pantalla de Acceso Sala habilita solo sus endpoints, y el portal lista las salas sin
// la direccion. App real con JWT firmado localmente, igual que permissionEscalation.
const PREFIX = "test-cr-";
let seq = 0;
let server: Server;
let baseUrl: string;

const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: ["comm_room_entries", "comm_room_access_grants", "comm_room_access_requests", "comm_rooms", "cost_centers"],
};

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
});

async function permissionId(key: string): Promise<number> {
  const [resource, action] = key.split(":");
  const permission = await PermissionModel.findOne({ where: { resource, action: action as PermissionAction } });
  if (!permission) throw new Error(`Falta el permiso sembrado ${key}`);
  return permission.id;
}

async function tokenWith(keys: string[]): Promise<string> {
  const role = await createRole({ name: `${PREFIX}${++seq}` });
  await setRolePermissions(role.id, await Promise.all(keys.map(permissionId)));
  const person = await createPerson({ firstName: "Test", lastName: `Cr${seq}`, documentId: `TESTDOC-CR${seq}`, email: `test-cr-${seq}@example.com` });
  const user = await createUser({ personId: person.id, roleId: role.id, username: `testcr${seq}` });
  return signAccessToken({ sub: user.id, personId: person.id, username: user.username, roleId: role.id, roleName: role.name });
}

async function api(path: string, token: string, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function room() {
  const costCenter = await createCostCenter({ code: 7000 + ++seq, name: `TEST Tienda ${seq}` });
  return { costCenter, room: await createRoom({ name: "Sala rack", costCenterId: costCenter.id, address: "Calle secreta 123" }, 1) };
}

describe("pantallas de Acceso Sala (plan 016)", () => {
  it("Crear Sala solo crea: no lista, no edita ni ve accesos", async () => {
    const { costCenter } = await room();
    const token = await tokenWith(["comm-room-creation:access"]);
    expect((await api("/comm-rooms", token, "POST", { name: "Sala B", costCenterId: costCenter.id, address: "Calle 2" })).status).toBe(201);
    expect((await api("/comm-rooms", token)).status).toBe(403);
    expect((await api("/comm-room-accesses", token)).status).toBe(403);
    expect((await api("/comm-room-entries", token)).status).toBe(403);
  });

  it("Registrar Ingreso registra y lista ingresos, pero no ve accesos ni revoca", async () => {
    const { room: created } = await room();
    const token = await tokenWith(["comm-room-entry:access"]);
    // Sin acceso vigente: 409 (el permiso alcanza, la regla de negocio rechaza).
    expect((await api("/comm-room-entries/check-in", token, "POST", { roomId: created.id, documentId: "12345678-5" })).status).toBe(409);
    expect((await api("/comm-room-entries", token)).status).toBe(200);
    // Elige la sala sin ver direcciones (revision L): no lista /comm-rooms.
    const roomsRes = await api("/comm-room-entries/rooms", token);
    expect(roomsRes.status).toBe(200);
    expect(((await roomsRes.json()) as { data: Record<string, unknown>[] }).data[0]).not.toHaveProperty("address");
    expect((await api("/comm-rooms", token)).status).toBe(403);
    expect((await api("/comm-room-accesses", token)).status).toBe(403);
    expect((await api("/comm-room-accesses/1/revoke", token, "POST", { reason: "x" })).status).toBe(403);
    expect((await api(`/comm-rooms/${created.id}`, token, "PUT", { name: "X", costCenterId: created.costCenterId, address: "Y" })).status).toBe(403);
  });

  it("Consulta de Accesos solo lee: no revoca ni registra ingresos", async () => {
    const { room: created } = await room();
    const token = await tokenWith(["comm-room-access-report:access"]);
    expect((await api("/comm-room-accesses?validNow=true", token)).status).toBe(200);
    expect((await api("/comm-room-accesses/reports/multi-room", token)).status).toBe(200);
    // Un minimo no finito ya no llega a la consulta (revision I1).
    expect((await api("/comm-room-accesses/reports/multi-room?minPlaces=Infinity", token)).status).toBe(200);
    expect((await api("/comm-room-accesses/1/revoke", token, "POST", { reason: "x" })).status).toBe(403);
    expect((await api("/comm-room-entries/check-in", token, "POST", { roomId: created.id, documentId: "12345678-5" })).status).toBe(403);
  });

  it("Administrar Salas edita y revoca; sin pantallas no hay acceso", async () => {
    const { room: created } = await room();
    const admin = await tokenWith(["comm-room-admin:access"]);
    expect((await api(`/comm-rooms/${created.id}`, admin, "PUT", { name: "Sala rack 2", costCenterId: created.costCenterId, address: "Calle 3" })).status).toBe(200);
    expect((await api("/comm-rooms/settings", admin, "PUT", { temporaryMaxActiveDays: 30 })).status).toBe(200);
    expect((await api("/comm-room-accesses/999999/revoke", admin, "POST", { reason: "Prueba" })).status).toBe(404);
    const nobody = await tokenWith([]);
    expect((await api("/comm-rooms", nobody)).status).toBe(403);
  });

  it("el portal y el agente listan las salas sin la direccion", async () => {
    await room();
    const portal = await tokenWith(["service-tickets:create"]);
    const portalRes = await api("/service-portal/comm-rooms", portal);
    expect(portalRes.status).toBe(200);
    const portalRooms = ((await portalRes.json()) as { data: Record<string, unknown>[] }).data;
    expect(portalRooms).toHaveLength(1);
    expect(portalRooms[0]).not.toHaveProperty("address");

    const agent = await tokenWith(["service-tickets:update"]);
    expect((await api("/service-tickets/comm-rooms", agent)).status).toBe(200);
    expect((await api("/service-tickets/comm-rooms", portal)).status).toBe(403);
  });
});
