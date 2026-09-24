import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response as ExpressResponse } from "express";
import { Op } from "sequelize";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../api";
import { resetTestData } from "../../test/setupIntegration";
import { postgres } from "../databases/postgres/connection";
import { signAccessToken } from "../library/jwt";
import { getServiceTicketFolder } from "../library/documentStorage";
import { PermissionModel, type PermissionAction } from "../models/postgres/permission.model";
import { RoleModel } from "../models/postgres/role.model";
import { createPerson } from "../services/mssql/person.service";
import { createUser } from "../services/mssql/user.service";
import { setRolePermissions } from "../services/postgres/permission.service";
import { createRole, getRoleByName } from "../services/postgres/role.service";
import * as changeService from "../services/postgres/serviceDesk/change.service";
import * as kbService from "../services/postgres/serviceDesk/kb.service";
import * as problemService from "../services/postgres/serviceDesk/problem.service";
import { createGroup, replaceGroupMembers } from "../services/postgres/serviceDesk/settings.service";

// Capa HTTP del Service Desk (plan 009): permisos, validacion Zod,
// aislamiento del portal y visibilidad de adjuntos. Las reglas de negocio las
// cubre services/postgres/serviceDesk/serviceDesk.service.integration.test.ts.
let seq = 0;
let server: Server;
let baseUrl: string;
const createdTickets = new Set<number>();

const ROLE_PREFIX = "test-sd-http-";

const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: [
    "service_ticket_kb",
    "kb_article_feedback",
    "kb_article_versions",
    "kb_articles",
    "service_problem_events",
    "service_problem_assets",
    "service_ticket_assets",
    "service_ticket_approvals",
    "service_ticket_attachments",
    "service_ticket_events",
    "service_change_tickets",
    "service_change_events",
    "service_change_assets",
    "service_change_approvals",
    "service_changes",
    "service_tickets",
    "service_problems",
    "service_desk_counters",
  ],
};

// PNG: firma real y sin pasar por qpdf (los PDF se sanean y eso lo cubren las pruebas de pdfSanitizer).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("prueba")]);

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
  for (const id of createdTickets) fs.rmSync(getServiceTicketFolder(id), { recursive: true, force: true });
  createdTickets.clear();
  await resetTestData(RESET_TABLES);
  await postgres.query(`DELETE FROM support_groups WHERE name LIKE 'TEST %'`);
  await RoleModel.destroy({ where: { name: { [Op.like]: `${ROLE_PREFIX}%` } } });
});

async function tokenFor(roleName: "admin" | "user") {
  const role = await getRoleByName(roleName);
  if (!role) throw new Error(`Falta el rol "${roleName}" sembrado`);
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `HttpSD${id}`,
    documentId: `TESTDOC-HTTPSD${id}`,
    email: `test-http-sd-${id}@example.com`,
  });
  const user = await createUser({ personId: person.id, roleId: role.id, username: `testhttpsd${id}` });
  return signAccessToken({ sub: user.id, personId: person.id, username: user.username, roleId: role.id, roleName });
}

async function permissionId(key: string): Promise<number> {
  const [resource, action] = key.split(":");
  const permission = await PermissionModel.findOne({ where: { resource, action: action as PermissionAction } });
  if (!permission) throw new Error(`Falta el permiso sembrado ${key}`);
  return permission.id;
}

// Usuario con un rol de prueba que tiene exactamente estos permisos.
async function userWith(keys: string[]): Promise<{ token: string; userId: number }> {
  const role = await createRole({ name: `${ROLE_PREFIX}${++seq}` });
  await setRolePermissions(role.id, await Promise.all(keys.map(permissionId)));
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `HttpSD${id}`,
    documentId: `TESTDOC-HTTPSD${id}`,
    email: `test-http-sd-${id}@example.com`,
  });
  const user = await createUser({ personId: person.id, roleId: role.id, username: `testhttpsd${id}` });
  const token = signAccessToken({ sub: user.id, personId: person.id, username: user.username, roleId: role.id, roleName: role.name });
  return { token, userId: user.id };
}

async function call(token: string, method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  return fetch(`${baseUrl}${path}`, init);
}

const INCIDENT = { type: "INCIDENT", title: "No hay red", description: "Sin conexion en la sala 2", impact: 2, urgency: 1 };

async function createIncident(token: string): Promise<{ id: number; number: string }> {
  const res = await call(token, "POST", "/service-portal/tickets", INCIDENT);
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: { id: number; number: string } };
  createdTickets.add(data.id);
  return data;
}

function imageForm(): FormData {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "captura.png");
  return form;
}

describe("Service Desk HTTP", () => {
  it("sin los permisos del Service Desk todo responde 403 (nada se otorga por defecto)", async () => {
    const plain = await tokenFor("user");
    for (const [method, path] of [
      ["GET", "/service-portal/tickets"],
      ["GET", "/service-portal/catalog"],
      ["GET", "/service-tickets"],
      // assets:read (que "user" tiene por defecto) no alcanza para ver el historial de tickets de un activo.
      ["GET", "/service-tickets/asset-history/1"],
      ["GET", "/service-problems"],
      ["GET", "/service-changes"],
      ["GET", "/kb-articles"],
      ["GET", "/service-desk-settings/groups"],
      ["GET", "/service-desk-settings/audit"],
      ["GET", "/service-desk-reports/summary"],
    ] as const) {
      const res = await call(plain, method, path);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    const created = await call(plain, "POST", "/service-portal/tickets", INCIDENT);
    expect(created.status).toBe(403);
  });

  it("valida el cuerpo con Zod (campos desconocidos y niveles fuera de rango)", async () => {
    const admin = await tokenFor("admin");
    const extra = await call(admin, "POST", "/service-portal/tickets", { ...INCIDENT, requesterUserId: 1 });
    expect(extra.status).toBe(400);
    const badLevel = await call(admin, "POST", "/service-portal/tickets", { ...INCIDENT, impact: 7 });
    expect(badLevel.status).toBe(400);
  });

  it("el portal solo entrega los tickets propios y nunca los adjuntos internos", async () => {
    const owner = await tokenFor("admin");
    const stranger = await tokenFor("admin");
    const ticket = await createIncident(owner);

    expect((await call(stranger, "GET", `/service-portal/tickets/${ticket.id}`)).status).toBe(404);
    expect((await call(stranger, "POST", `/service-portal/tickets/${ticket.id}/comments`, { body: "hola" })).status).toBe(404);
    const strangerList = (await (await call(stranger, "GET", "/service-portal/tickets")).json()) as { data: { items: unknown[] } };
    expect(strangerList.data.items).toHaveLength(0);

    // Adjunto interno del agente: visible en la vista del agente, invisible (404) en el portal.
    const internal = await call(stranger, "POST", `/service-tickets/${ticket.id}/attachments?internal=true`, imageForm());
    expect(internal.status).toBe(201);
    const { data: attachment } = (await internal.json()) as { data: { id: number; isPublic: boolean } };
    expect(attachment.isPublic).toBe(false);
    expect((await call(owner, "GET", `/service-portal/tickets/${ticket.id}/attachments/${attachment.id}`)).status).toBe(404);
    const agentDownload = await call(stranger, "GET", `/service-tickets/${ticket.id}/attachments/${attachment.id}`);
    expect(agentDownload.status).toBe(200);
    expect(agentDownload.headers.get("x-content-type-options")).toBe("nosniff");

    // El adjunto del solicitante si se ve en su portal.
    const own = await call(owner, "POST", `/service-portal/tickets/${ticket.id}/attachments`, imageForm());
    expect(own.status).toBe(201);
    const detail = (await (await call(owner, "GET", `/service-portal/tickets/${ticket.id}`)).json()) as {
      data: { attachments: unknown[]; events: { eventType: string }[] };
    };
    expect(detail.data.attachments).toHaveLength(1);
    expect(detail.data.events.every((event) => event.eventType !== "WORK_NOTE")).toBe(true);
  });

  it("rechaza adjuntos cuyo contenido no coincide con el tipo declarado", async () => {
    const admin = await tokenFor("admin");
    const ticket = await createIncident(admin);
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("<script>alert(1)</script>")], { type: "application/pdf" }), "x.pdf");
    const res = await call(admin, "POST", `/service-portal/tickets/${ticket.id}/attachments`, form);
    expect(res.status).toBe(400);
  });

  it("rechaza correos adjuntos (.eml) aunque el contenido sea valido (run-3, F7)", async () => {
    const admin = await tokenFor("admin");
    const ticket = await createIncident(admin);
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("From: a@b.cl\r\nSubject: hola\r\n\r\ncuerpo")], { type: "message/rfc822" }), "correo.eml");
    expect((await call(admin, "POST", `/service-portal/tickets/${ticket.id}/attachments`, form)).status).toBe(400);
  });

  it("la busqueda de conocimiento solo muestra articulos internos a quien trabaja tickets (run-3, F1)", async () => {
    const internal = await kbService.createArticle(
      { title: "Clave del router de bodega", body: "Procedimiento interno para el router de bodega.", audience: "INTERNAL" },
      1,
    );
    const shared = await kbService.createArticle(
      { title: "Reiniciar el router de la casa", body: "Desenchufar el router y esperar un minuto.", audience: "PUBLIC" },
      1,
    );
    for (const article of [internal, shared]) await kbService.changeArticleStatus(article.id, "PUBLISHED", { userId: 1, canApprove: true });

    const portal = await userWith(["service-tickets:create", "kb-articles:read"]);
    const agent = await userWith(["service-tickets:read", "kb-articles:read"]);
    const idsFor = async (token: string) => {
      const res = await call(token, "GET", "/kb-articles/search?search=router");
      expect(res.status).toBe(200);
      return ((await res.json()) as { data: { id: number }[] }).data.map((article) => article.id);
    };
    expect(await idsFor(portal.token)).toEqual([shared.id]);
    expect((await idsFor(agent.token)).sort()).toEqual([internal.id, shared.id].sort());
  });

  it("con permisos de problemas no se vinculan ni resuelven incidentes sin trabajar tickets (run-3, F4)", async () => {
    const requester = await tokenFor("admin");
    const ticket = await createIncident(requester);
    const problem = await problemService.createProblem({ title: "Red lenta", description: "Varias salas", impact: 2, urgency: 2 }, 1);
    const manager = await userWith(["service-problems:read", "service-problems:update"]);

    expect((await call(manager.token, "POST", `/service-problems/${problem.id}/incidents`, { ids: [ticket.id] })).status).toBe(403);
    expect(
      (await call(manager.token, "POST", `/service-problems/${problem.id}/status`, { status: "UNDER_INVESTIGATION", resolveLinkedIncidents: true })).status,
    ).toBe(403);
    expect((await call(manager.token, "POST", `/service-problems/${problem.id}/status`, { status: "UNDER_INVESTIGATION" })).status).toBe(200);
  });

  it("un agente solo abre los tickets de sus grupos (run-3)", async () => {
    const requester = await tokenFor("admin");
    const ticket = await createIncident(requester);
    const agent = await userWith(["service-tickets:read", "service-tickets:update"]);
    const team = await createGroup({ name: `TEST Grupo HTTP ${++seq}` });
    await replaceGroupMembers(team.id, [{ userId: agent.userId, isLead: false }]);

    expect((await call(agent.token, "GET", `/service-tickets/${ticket.id}`)).status).toBe(404);
    expect((await call(agent.token, "POST", `/service-tickets/${ticket.id}/comments`, { body: "hola", isPublic: false })).status).toBe(404);
    const list = (await (await call(agent.token, "GET", "/service-tickets")).json()) as { data: { items: { id: number }[] } };
    expect(list.data.items.map((item) => item.id)).not.toContain(ticket.id);
    // El admin ve todo.
    expect((await call(requester, "GET", `/service-tickets/${ticket.id}`)).status).toBe(200);
  });

  it("el detalle de un problema solo lista los incidentes de los grupos de quien consulta (run-3, N2)", async () => {
    const requester = await tokenFor("admin");
    const ticket = await createIncident(requester);
    const problem = await problemService.createProblem(
      { title: "Red lenta", description: "Varias salas", impact: 2, urgency: 2, incidentIds: [ticket.id] },
      1,
    );
    const manager = await userWith(["service-problems:read", "service-tickets:read"]);
    const detailFor = async (token: string) => {
      const res = await call(token, "GET", `/service-problems/${problem.id}`);
      expect(res.status).toBe(200);
      return ((await res.json()) as { data: { incidents: { id: number }[] } }).data.incidents.map((incident) => incident.id);
    };
    expect(await detailFor(manager.token)).toEqual([]);
    expect(await detailFor(requester)).toEqual([ticket.id]);
  });

  it("cada cambio de configuracion queda auditado con su autor (run-3, F6)", async () => {
    const admin = await tokenFor("admin");
    const name = `TEST Grupo HTTP ${++seq}`;
    const created = await call(admin, "POST", "/service-desk-settings/groups", { name });
    expect(created.status).toBe(201);
    const { data: group } = (await created.json()) as { data: { id: number } };
    expect((await call(admin, "PUT", `/service-desk-settings/groups/${group.id}`, { name, isActive: false })).status).toBe(200);

    const res = await call(admin, "GET", "/service-desk-settings/audit?entity=group&limit=10");
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { items: { entity: string; entityId: number; action: string; actorName: string | null; payload: { body: { name: string } } }[] };
    };
    const mine = data.items.filter((item) => item.entityId === group.id);
    expect(mine.map((item) => item.action)).toEqual(["UPDATE", "CREATE"]);
    expect(mine[0]!.payload.body.name).toBe(name);
    expect(mine[0]!.actorName).toMatch(/HttpSD/);
    // El registro no se puede alterar ni borrar, ni siquiera por SQL (run-3 final, L5).
    await expect(postgres.query(`DELETE FROM service_desk_audit_log WHERE entity_id = :id`, { replacements: { id: group.id } })).rejects.toThrow();
    await expect(postgres.query(`UPDATE service_desk_audit_log SET actor_user_id = 0 WHERE entity_id = :id`, { replacements: { id: group.id } })).rejects.toThrow();
  });

  it("editar un cambio no suelta los tickets vinculados que el agente no ve (run-3 final, L1)", async () => {
    const admin = await tokenFor("admin");
    const ticket = await createIncident(admin);
    const change = await changeService.createChange(
      { type: "NORMAL", title: "Cambio de switch", description: "Piso 2", risk: "LOW", impact: 2, ticketIds: [ticket.id] },
      1,
    );
    const agent = await userWith(["service-changes:read", "service-changes:update"]);
    const res = await call(agent.token, "PUT", `/service-changes/${change.id}`, {
      title: "Cambio de switch",
      description: "Piso 2 y 3",
      risk: "LOW",
      impact: 2,
      ticketIds: [],
    });
    expect(res.status).toBe(200);
    const detail = (await (await call(admin, "GET", `/service-changes/${change.id}`)).json()) as { data: { tickets: { id: number }[] } };
    expect(detail.data.tickets.map((item) => item.id)).toEqual([ticket.id]);
  });

  it("frena la enumeracion de usuarios por busqueda (run-3, F8)", async () => {
    const agent = await userWith(["service-tickets:read", "service-tickets:update"]);
    let limited = false;
    for (let attempt = 0; attempt < 70 && !limited; attempt += 1) {
      const res = await call(agent.token, "GET", `/service-tickets/users?search=zz${attempt}`);
      if (res.status === 429) limited = true;
      else expect(res.status).toBe(200);
    }
    expect(limited).toBe(true);
  });

  it("la campana suma los pendientes del Service Desk", async () => {
    const admin = await tokenFor("admin");
    const res = await call(admin, "GET", "/notifications/pending-summary");
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, number> };
    expect(data).toMatchObject({ assignedOpenTickets: 0, pendingTicketApprovals: 0, pendingChangeApprovals: 0 });
  });
});
