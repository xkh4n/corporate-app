import fs from "node:fs";
import { Op, QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../../test/setupIntegration";
import { postgres } from "../../../databases/postgres/connection";
import { getServiceTicketFolder } from "../../../library/documentStorage";
import { PermissionModel } from "../../../models/postgres/permission.model";
import { RoleModel } from "../../../models/postgres/role.model";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../../library/errors";
import { createPerson } from "../../mssql/person.service";
import { createUser } from "../../mssql/user.service";
import { createProduct } from "../../mongo/product.service";
import { createAssetsFromReceipt } from "../asset.service";
import { assignAssetToUser, createAssetMovement, listCurrentHoldersByAssetIds } from "../assetMovement.service";
import { createCostCenter } from "../costCenter.service";
import { setRolePermissions } from "../permission.service";
import { createRole, getRoleByName } from "../role.service";
import * as changeService from "./change.service";
import * as kbService from "./kb.service";
import * as problemService from "./problem.service";
import { createCatalogItem, createGroup, getGroupOrThrow, replaceGroupMembers, updateGroup } from "./settings.service";
import { sweepServiceDeskSla } from "./slaSweeper";
import * as ticketService from "./ticket.service";
import * as ticketAssetService from "./ticketAsset.service";
import { resolveTicketScope } from "./ticketScope";

// Service Desk ITIL v4 (plan 009): reglas de negocio contra el stack de
// Testing. La configuracion sembrada (calendario, matriz, SLA, categorias) se
// usa tal cual; los grupos e items de catalogo de prueba llevan el prefijo
// TEST y se borran al terminar.
const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: [
    "service_ticket_kb",
    "kb_article_feedback",
    "kb_article_versions",
    "kb_articles",
    "service_change_tickets",
    "service_change_assets",
    "service_change_approvals",
    "service_change_events",
    "service_changes",
    "service_problem_events",
    "service_problem_assets",
    "service_problems",
    "service_ticket_assets",
    "service_ticket_approvals",
    "service_ticket_attachments",
    "service_ticket_events",
    "service_tickets",
    "service_desk_counters",
    "asset_movement_users",
    "asset_movements",
    "asset_kardex_entries",
    "assets",
    "cost_centers",
  ],
  mongo: ["Product"],
};

let seq = 0;
const createdTickets = new Set<number>();
// Usuarios de prueba agregados a grupos sembrados: los ids se reciclan entre pruebas.
const joinedUsers = new Set<number>();
const PAGE = { page: 1, limit: 50, sortBy: "id", sortOrder: "desc" as const };

async function cleanupConfig(): Promise<void> {
  await postgres.query(`DELETE FROM service_catalog_items WHERE name LIKE 'TEST %'`);
  await postgres.query(`DELETE FROM support_groups WHERE name LIKE 'TEST %'`);
  await RoleModel.destroy({ where: { name: { [Op.like]: "test-sd-svc-%" } } });
  if (joinedUsers.size > 0) {
    await postgres.query(`DELETE FROM support_group_members WHERE user_id IN (:ids)`, { replacements: { ids: [...joinedUsers] } });
    joinedUsers.clear();
  }
}

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
  await cleanupConfig();
});

afterEach(async () => {
  for (const id of createdTickets) fs.rmSync(getServiceTicketFolder(id), { recursive: true, force: true });
  createdTickets.clear();
  await resetTestData(RESET_TABLES);
  await cleanupConfig();
});

async function user(roleName: "user" | "admin" = "user") {
  const role = await getRoleByName(roleName);
  if (!role) throw new Error(`Falta el rol ${roleName}`);
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `ServiceDesk${id}`,
    documentId: `TESTDOC-SD${id}`,
    email: `test-sd-${id}@example.com`,
  });
  return createUser({ personId: person.id, roleId: role.id, username: `testsd${id}` });
}

async function group(members: number[], leadIds: number[] = []) {
  const created = await createGroup({ name: `TEST Grupo ${++seq}` });
  await replaceGroupMembers(
    created.id,
    members.map((userId) => ({ userId, isLead: leadIds.includes(userId) })),
  );
  return created;
}

// Agrega al usuario a un grupo sembrado (la categoria de prueba enruta a "Soporte N2").
async function joinGroup(userId: number, name: string): Promise<void> {
  await postgres.query(
    `INSERT INTO support_group_members (group_id, user_id, is_lead)
     SELECT id, :userId, false FROM support_groups WHERE name = :name ON CONFLICT DO NOTHING`,
    { replacements: { userId, name } },
  );
  joinedUsers.add(userId);
}

// Jefe de Soporte TI: rol de prueba con service-tickets:all_view.
async function chiefUser() {
  const permission = await PermissionModel.findOne({ where: { resource: "service-tickets", action: "all_view" } });
  if (!permission) throw new Error("Falta el permiso sembrado service-tickets:all_view");
  const role = await createRole({ name: `test-sd-svc-${++seq}` });
  await setRolePermissions(role.id, [permission.id]);
  const id = ++seq;
  const person = await createPerson({ firstName: "Test", lastName: `Jefe${id}`, documentId: `TESTDOC-SDJ${id}`, email: `test-sd-j${id}@example.com` });
  const created = await createUser({ personId: person.id, roleId: role.id, username: `testsdj${id}` });
  return { id: created.id, roleId: role.id };
}

// Miembro de todos los grupos activos (ya no da visibilidad total).
async function joinAllGroups(userId: number): Promise<void> {
  await postgres.query(
    `INSERT INTO support_group_members (group_id, user_id, is_lead)
     SELECT id, :userId, true FROM support_groups WHERE is_active ON CONFLICT DO NOTHING`,
    { replacements: { userId } },
  );
  joinedUsers.add(userId);
}

async function categoryId(name: string): Promise<number> {
  const [row] = await postgres.query<{ id: number }>(`SELECT id FROM service_categories WHERE name = :name AND parent_id IS NULL`, {
    replacements: { name },
    type: QueryTypes.SELECT,
  });
  if (!row) throw new Error(`Falta la categoria sembrada ${name}`);
  return row.id;
}

async function incident(requesterId: number, extra: Partial<ticketService.CreateTicketInput> = {}) {
  const created = await ticketService.createTicket(
    {
      type: "INCIDENT",
      title: "No imprime",
      description: "La impresora del piso 3 no responde",
      impact: 3,
      urgency: 2,
      categoryId: await categoryId("Impresoras"),
      ...extra,
    },
    { userId: requesterId },
    "PORTAL",
  );
  createdTickets.add(created.id);
  return created;
}

async function heldAsset(holderId: number) {
  const costCenter = await createCostCenter({ code: 68000 + ++seq, name: "Centro SD" });
  const product = await createProduct({ name: `Notebook SD ${++seq}`, productType: "COMPRA" });
  const [asset] = await createAssetsFromReceipt({
    goodsReceiptId: 992000 + ++seq,
    productId: String(product._id),
    quantity: 1,
    costCenterId: costCenter.id,
    serialNumbers: [`SN-SD-${seq}`],
    value: "500.00",
    finalStatusCode: "AVAILABLE",
  });
  await assignAssetToUser({ assetId: asset!.id, userId: holderId });
  return asset!;
}

async function eventCount(ticketId: number, eventType: string): Promise<number> {
  const [row] = await postgres.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM service_ticket_events WHERE ticket_id = :ticketId AND event_type = :eventType`,
    { replacements: { ticketId, eventType }, type: QueryTypes.SELECT },
  );
  return row?.total ?? 0;
}

describe("incidentes: alta, visibilidad y asignacion", () => {
  it("registra con folio, prioridad de la matriz, grupo de la categoria y SLA", async () => {
    const requester = await user();
    const ticket = await incident(requester.id);
    // Sin guiones y con el codigo del grupo que lo recibe (Soporte N2).
    expect(ticket.number).toMatch(/^INC\d{4}\d{2}000001$/);
    const [group] = await postgres.query<{ code: string }>(`SELECT code FROM support_groups WHERE name = 'Soporte N2'`, {
      type: QueryTypes.SELECT,
    });
    expect(ticket.number.slice(7, 9)).toBe(group!.code);
    expect(ticket.status).toBe("NEW");
    // Impacto 3 (solo yo) x urgencia 2 = P4 en la matriz por defecto.
    expect(ticket.priority).toBe("P4");
    expect(ticket.assignedGroupName).toBe("Soporte N2");
    expect(ticket.responseDueAt).not.toBeNull();
    expect(new Date(ticket.resolutionDueAt!).getTime()).toBeGreaterThan(new Date(ticket.responseDueAt!).getTime());
    expect(await eventCount(ticket.id, "CREATED")).toBe(1);
  });

  it("el portal no revela tickets ajenos ni notas internas", async () => {
    const requester = await user();
    const other = await user();
    const agent = await user();
    await joinGroup(agent.id, "Soporte N2");
    const ticket = await incident(requester.id);

    await expect(ticketService.getTicketDetail(ticket.id, { audience: "requester", requesterUserId: other.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(ticketService.addComment(ticket.id, { body: "hola", isPublic: true }, { userId: other.id }, "requester")).rejects.toBeInstanceOf(
      NotFoundError,
    );

    await ticketService.addComment(ticket.id, { body: "revisar driver", isPublic: false }, { userId: agent.id }, "agent");
    await ticketService.addComment(ticket.id, { body: "ya vamos", isPublic: true }, { userId: agent.id }, "agent");
    const pdf = { mimetype: "application/pdf", buffer: Buffer.from("%PDF-1.4 x"), size: 10, originalname: "log.pdf" } as Express.Multer.File;
    await ticketService.addAttachment(ticket.id, pdf, { userId: agent.id }, { audience: "agent", isPublic: false });

    const asRequester = await ticketService.getTicketDetail(ticket.id, { audience: "requester", requesterUserId: requester.id });
    expect(asRequester.events.some((event) => event.eventType === "WORK_NOTE")).toBe(false);
    expect(asRequester.events.some((event) => event.body === "ya vamos")).toBe(true);
    expect(asRequester.attachments).toHaveLength(0);
    const asAgent = await ticketService.getTicketDetail(ticket.id, { audience: "agent" });
    expect(asAgent.events.some((event) => event.eventType === "WORK_NOTE")).toBe(true);
    expect(asAgent.attachments).toHaveLength(1);
  });

  it("solo asigna a miembros del grupo y la asignacion cuenta como primera respuesta", async () => {
    const requester = await user();
    const agent = await user();
    const outsider = await user();
    const team = await group([agent.id]);
    await joinGroup(agent.id, "Soporte N2");
    const ticket = await incident(requester.id);

    await expect(ticketService.assignTicket(ticket.id, { groupId: team.id, assigneeUserId: outsider.id }, { userId: agent.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const assigned = await ticketService.assignTicket(ticket.id, { groupId: team.id, assigneeUserId: agent.id }, { userId: agent.id });
    expect(assigned.status).toBe("ASSIGNED");
    expect(assigned.firstResponseAt).not.toBeNull();
    expect(await eventCount(ticket.id, "ESCALATED")).toBe(1);
  });
});

describe("incidentes: ciclo de vida y SLA", () => {
  it("pausa en espera, se retoma con la respuesta del solicitante, resuelve, reabre y cierra con encuesta", async () => {
    const requester = await user();
    const agent = await user();
    const team = await group([agent.id]);
    await joinGroup(agent.id, "Soporte N2");
    const ticket = await incident(requester.id);
    await ticketService.assignTicket(ticket.id, { groupId: team.id, assigneeUserId: agent.id }, { userId: agent.id });
    await ticketService.changeStatus(ticket.id, { status: "IN_PROGRESS" }, { userId: agent.id });

    await expect(ticketService.changeStatus(ticket.id, { status: "ON_HOLD" }, { userId: agent.id })).rejects.toBeInstanceOf(BadRequestError);
    const onHold = await ticketService.changeStatus(ticket.id, { status: "ON_HOLD", onHoldReason: "AWAITING_USER" }, { userId: agent.id });
    expect(onHold.status).toBe("ON_HOLD");
    expect(onHold.slaState).toBe("PAUSED");

    // Responder retoma el ticket (solo si esperaba al solicitante).
    const resumed = await ticketService.addComment(ticket.id, { body: "adjunto el error", isPublic: true }, { userId: requester.id }, "requester");
    expect(resumed.status).toBe("IN_PROGRESS");
    expect(resumed.onHoldSince).toBeNull();

    await expect(ticketService.changeStatus(ticket.id, { status: "RESOLVED", resolutionCode: "FIXED" }, { userId: agent.id })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    const resolved = await ticketService.changeStatus(
      ticket.id,
      { status: "RESOLVED", resolutionCode: "FIXED", resolutionNotes: "Se reinstalo el driver" },
      { userId: agent.id },
    );
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.autoCloseAt).not.toBeNull();

    await expect(ticketService.requesterAction(ticket.id, "reopen", {}, { userId: requester.id })).rejects.toBeInstanceOf(BadRequestError);
    const reopened = await ticketService.requesterAction(ticket.id, "reopen", { comment: "sigue fallando" }, { userId: requester.id });
    expect(reopened.status).toBe("IN_PROGRESS");
    expect(reopened.reopenCount).toBe(1);

    await ticketService.changeStatus(ticket.id, { status: "RESOLVED", resolutionCode: "FIXED", resolutionNotes: "Cambio de cable" }, { userId: agent.id });
    const closed = await ticketService.requesterAction(ticket.id, "confirm", { csatScore: 5, csatComment: "rapido" }, { userId: requester.id });
    expect(closed.status).toBe("CLOSED");
    expect(closed.csatScore).toBe(5);

    await expect(ticketService.addComment(ticket.id, { body: "otra cosa", isPublic: true }, { userId: requester.id }, "requester")).rejects.toBeInstanceOf(
      ConflictError,
    );
    // Un tercero nunca puede operar el ticket como solicitante.
    await expect(ticketService.requesterAction(ticket.id, "cancel", {}, { userId: agent.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cambiar la prioridad recalcula el vencimiento", async () => {
    const requester = await user();
    const agent = await user();
    await joinGroup(agent.id, "Soporte N2");
    const ticket = await incident(requester.id);
    const updated = await ticketService.updateClassification(ticket.id, { impact: 1, urgency: 1 }, { userId: agent.id });
    expect(updated.priority).toBe("P1");
    expect(new Date(updated.resolutionDueAt!).getTime()).toBeLessThan(new Date(ticket.resolutionDueAt!).getTime());
    expect(await eventCount(ticket.id, "PRIORITY_CHANGED")).toBe(1);
  });

  it("el barrido marca el incumplimiento una sola vez aunque corran dos a la vez", async () => {
    const requester = await user();
    const ticket = await incident(requester.id);
    await postgres.query(
      `UPDATE service_tickets SET response_due_at = now() - interval '2 hours', resolution_due_at = now() - interval '1 hour',
              resolution_warn_at = now() - interval '3 hours' WHERE id = :id`,
      { replacements: { id: ticket.id } },
    );
    await Promise.all([sweepServiceDeskSla(), sweepServiceDeskSla()]);
    await sweepServiceDeskSla();
    const [row] = await postgres.query<{ responseBreached: boolean; resolutionBreached: boolean }>(
      `SELECT response_breached AS "responseBreached", resolution_breached AS "resolutionBreached" FROM service_tickets WHERE id = :id`,
      { replacements: { id: ticket.id }, type: QueryTypes.SELECT },
    );
    expect(row).toEqual({ responseBreached: true, resolutionBreached: true });
    // Una marca de respuesta + una de resolucion; el aviso del 75 % no aplica a lo ya vencido.
    expect(await eventCount(ticket.id, "SLA_BREACHED")).toBe(2);
    expect(await eventCount(ticket.id, "SLA_WARNING")).toBe(0);
  });

  it("el barrido cierra los resueltos cuyo plazo de confirmacion vencio", async () => {
    const requester = await user();
    const agent = await user();
    const team = await group([agent.id]);
    await joinGroup(agent.id, "Soporte N2");
    const ticket = await incident(requester.id);
    await ticketService.assignTicket(ticket.id, { groupId: team.id, assigneeUserId: agent.id }, { userId: agent.id });
    await ticketService.changeStatus(ticket.id, { status: "RESOLVED", resolutionCode: "FIXED", resolutionNotes: "listo" }, { userId: agent.id });
    await postgres.query(`UPDATE service_tickets SET auto_close_at = now() - interval '1 minute' WHERE id = :id`, { replacements: { id: ticket.id } });
    await sweepServiceDeskSla();
    const detail = await ticketService.getTicketDetail(ticket.id, { audience: "agent" });
    expect(detail.status).toBe("CLOSED");
  });
});

describe("solicitudes del catalogo con aprobacion", () => {
  it("espera aprobacion sin SLA y solo un miembro del grupo aprobador (no el solicitante) decide", async () => {
    const requester = await user();
    const approver = await user();
    const outsider = await user();
    const approvers = await group([approver.id, requester.id]);
    const item = await createCatalogItem({
      name: `TEST Licencia ${++seq}`,
      approvalGroupId: approvers.id,
      fields: [{ key: "software", label: "Software", type: "text", required: true }],
    });
    const base = { type: "SERVICE_REQUEST" as const, title: "Licencia Visio", description: "Para diagramas de red", impact: 3, urgency: 3, catalogItemId: item.id };

    await expect(ticketService.createTicket({ ...base, variables: {} }, { userId: requester.id }, "PORTAL")).rejects.toBeInstanceOf(BadRequestError);
    const ticket = await ticketService.createTicket({ ...base, variables: { software: "Visio" } }, { userId: requester.id }, "PORTAL");
    createdTickets.add(ticket.id);
    expect(ticket.number).toMatch(/^REQ-/);
    expect(ticket.status).toBe("PENDING_APPROVAL");
    expect(ticket.resolutionDueAt).toBeNull();

    await expect(ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: requester.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: outsider.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ticketService.decideApproval(ticket.id, { decision: "REJECTED" }, { userId: approver.id })).rejects.toBeInstanceOf(BadRequestError);

    const approved = await ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: approver.id });
    expect(approved.status).toBe("NEW");
    expect(approved.resolutionDueAt).not.toBeNull();
    const pending = await ticketService.listPendingApprovals({ userId: approver.id }, { page: 1, limit: 10, sortBy: "id", sortOrder: "asc" });
    expect(pending.total).toBe(0);
  });

  it("quien registra la solicitud a nombre de otro no puede aprobarla (run-3, F2)", async () => {
    const requester = await user();
    const agent = await user();
    const approver = await user();
    const approvers = await group([agent.id, approver.id]);
    const item = await createCatalogItem({ name: `TEST Acceso ${++seq}`, approvalGroupId: approvers.id, fields: [] });
    const ticket = await ticketService.createTicket(
      { type: "SERVICE_REQUEST", title: "Acceso VPN", description: "Trabajo remoto", impact: 3, urgency: 3, catalogItemId: item.id, requesterUserId: requester.id },
      { userId: agent.id },
      "AGENT",
    );
    createdTickets.add(ticket.id);

    await expect(ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: agent.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await ticketService.listPendingApprovals({ userId: agent.id }, PAGE)).total).toBe(0);
    expect((await ticketService.listPendingApprovals({ userId: approver.id }, PAGE)).total).toBe(1);
    // El aprobador no es de la cola: lee la solicitud pendiente sin lo interno (run-3, N3).
    await ticketService.addComment(ticket.id, { body: "nota interna", isPublic: false }, { userId: agent.id, isAdmin: true }, "agent");
    const scope = await resolveTicketScope({ userId: approver.id });
    const asApprover = await ticketService.getTicketDetail(ticket.id, { audience: "agent", scope });
    expect(asApprover.events.some((event) => event.eventType === "WORK_NOTE")).toBe(false);
    expect(asApprover.allowedTransitions).toEqual([]);
    const decided = await ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: approver.id });
    expect(decided.status).toBe("NEW");
    // Tampoco la respuesta de la decision le entrega lo interno (run-3 final, L2).
    expect(decided.events.some((event) => event.eventType === "WORK_NOTE")).toBe(false);
    await expect(ticketService.getTicketDetail(ticket.id, { audience: "agent", scope })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("el grupo aprobador queda fijado en la solicitud al crearla (run-3 final, L6)", async () => {
    const requester = await user();
    const original = await user();
    const intruder = await user();
    const approvers = await group([original.id]);
    const other = await group([intruder.id]);
    const item = await createCatalogItem({ name: `TEST Equipo ${++seq}`, approvalGroupId: approvers.id, fields: [] });
    const ticket = await ticketService.createTicket(
      { type: "SERVICE_REQUEST", title: "Monitor extra", description: "Segundo monitor", impact: 3, urgency: 3, catalogItemId: item.id },
      { userId: requester.id },
      "PORTAL",
    );
    createdTickets.add(ticket.id);
    // Cambiar el item despues no cambia quien aprueba lo que ya estaba pendiente.
    await postgres.query(`UPDATE service_catalog_items SET approval_group_id = :other WHERE id = :id`, { replacements: { other: other.id, id: item.id } });
    await expect(ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: intruder.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await ticketService.listPendingApprovals({ userId: intruder.id }, PAGE)).total).toBe(0);
    expect((await ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: original.id })).status).toBe("NEW");
  });
});

describe("activos del ticket", () => {
  it("el portal solo declara activos propios; enviar a soporte bloquea la resolucion y devolver restaura al custodio", async () => {
    const requester = await user();
    const other = await user();
    const agent = await user();
    const team = await group([agent.id]);
    await joinGroup(agent.id, "Soporte N2");
    const mine = await heldAsset(requester.id);
    const foreign = await heldAsset(other.id);

    await expect(incident(requester.id, { assetIds: [foreign.id] })).rejects.toBeInstanceOf(ConflictError);
    const ticket = await incident(requester.id, { assetIds: [mine.id] });
    await ticketService.assignTicket(ticket.id, { groupId: team.id, assigneeUserId: agent.id }, { userId: agent.id });

    const actor = { userId: agent.id };
    await ticketAssetService.sendAssetToSupport(ticket.id, mine.id, actor, "no enciende");
    let detail = await ticketService.getTicketDetail(ticket.id, { audience: "agent" });
    expect(detail.assets[0]).toMatchObject({ statusCode: "SUPPORT", inSupport: true, holderUserId: requester.id });

    // Otro ticket puede vincularlo (trazabilidad), pero no volver a mandarlo a soporte.
    // En soporte no tiene custodio: el solicitante ya no lo ve como suyo, lo vincula un agente.
    await expect(incident(requester.id, { assetIds: [mine.id] })).rejects.toBeInstanceOf(ConflictError);
    const second = await ticketService.createTicket(
      { type: "INCIDENT", title: "Mismo equipo", description: "Reporte repetido del equipo", impact: 3, urgency: 3, assetIds: [mine.id], assignedGroupId: team.id },
      actor,
      "AGENT",
    );
    createdTickets.add(second.id);
    await ticketService.assignTicket(second.id, { groupId: team.id, assigneeUserId: agent.id }, actor);
    await expect(ticketAssetService.sendAssetToSupport(second.id, mine.id, actor)).rejects.toBeInstanceOf(ConflictError);

    await expect(
      ticketService.changeStatus(ticket.id, { status: "RESOLVED", resolutionCode: "FIXED", resolutionNotes: "listo" }, { userId: agent.id }),
    ).rejects.toBeInstanceOf(ConflictError);

    await ticketAssetService.returnAssetFromSupport(ticket.id, mine.id, "HOLDER", actor);
    detail = await ticketService.getTicketDetail(ticket.id, { audience: "agent" });
    expect(detail.assets[0]).toMatchObject({ statusCode: "ASSIGNED", inSupport: false });
    expect((await listCurrentHoldersByAssetIds([mine.id])).get(mine.id)).toBe(requester.id);
    await expect(ticketAssetService.unlinkAsset(ticket.id, mine.id, actor)).rejects.toBeInstanceOf(ConflictError);

    const resolved = await ticketService.changeStatus(
      ticket.id,
      { status: "RESOLVED", resolutionCode: "FIXED", resolutionNotes: "Cambio de fuente" },
      { userId: agent.id },
    );
    expect(resolved.status).toBe("RESOLVED");
    const history = await ticketAssetService.listAssetServiceHistory(mine.id, await resolveTicketScope(actor));
    expect(history.map((record) => record.number)).toContain(ticket.number);
    // Un agente de otro grupo no ve esos tickets en el historial del activo.
    const outsider = await user();
    await group([outsider.id]);
    expect(await ticketAssetService.listAssetServiceHistory(mine.id, await resolveTicketScope({ userId: outsider.id }))).toHaveLength(0);
  });

  it("dos envios simultaneos del mismo activo desde tickets distintos: solo uno gana", async () => {
    const requester = await user();
    const agent = await user();
    const team = await group([agent.id]);
    await joinGroup(agent.id, "Soporte N2");
    const actor = { userId: agent.id };
    const asset = await heldAsset(requester.id);
    const first = await incident(requester.id, { assetIds: [asset.id] });
    const second = await ticketService.createTicket(
      { type: "INCIDENT", title: "Pantalla", description: "Parpadea la pantalla", impact: 3, urgency: 3, assignedGroupId: team.id },
      actor,
      "AGENT",
    );
    createdTickets.add(second.id);
    await ticketAssetService.linkAssets(second.id, [asset.id], actor);
    for (const id of [first.id, second.id]) await ticketService.assignTicket(id, { groupId: team.id, assigneeUserId: agent.id }, actor);

    const results = await Promise.allSettled([
      ticketAssetService.sendAssetToSupport(first.id, asset.id, actor),
      ticketAssetService.sendAssetToSupport(second.id, asset.id, actor),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [row] = await postgres.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM asset_movements WHERE asset_id = :id AND movement_type = 'SUPPORT'`,
      { replacements: { id: asset.id }, type: QueryTypes.SELECT },
    );
    expect(row?.total).toBe(1);
  });

  it("no se anula un ticket con un activo en soporte y solo un ticket atendido lo envia (run-3, F5)", async () => {
    const requester = await user();
    const agent = await user();
    const team = await group([agent.id]);
    await joinGroup(agent.id, "Soporte N2");
    const actor = { userId: agent.id };
    const asset = await heldAsset(requester.id);
    const ticket = await incident(requester.id, { assetIds: [asset.id] });

    // En cola (NEW) todavia no lo atiende nadie.
    await expect(ticketAssetService.sendAssetToSupport(ticket.id, asset.id, actor)).rejects.toBeInstanceOf(ConflictError);
    await ticketService.assignTicket(ticket.id, { groupId: team.id, assigneeUserId: agent.id }, actor);
    await ticketAssetService.sendAssetToSupport(ticket.id, asset.id, actor);

    await expect(ticketService.requesterAction(ticket.id, "cancel", {}, { userId: requester.id })).rejects.toBeInstanceOf(ConflictError);
    await expect(ticketService.changeStatus(ticket.id, { status: "CANCELLED" }, actor)).rejects.toBeInstanceOf(ConflictError);
    // Tampoco se da de baja desde Movimientos mientras el ticket lo tiene (run-3, N4).
    await expect(createAssetMovement({ assetId: asset.id, movementType: "DECOMMISSIONED", createdBy: agent.id })).rejects.toBeInstanceOf(
      ConflictError,
    );

    await ticketAssetService.returnAssetFromSupport(ticket.id, asset.id, "HOLDER", actor);
    const cancelled = await ticketService.requesterAction(ticket.id, "cancel", {}, { userId: requester.id });
    expect(cancelled.status).toBe("CANCELLED");
    expect((await listCurrentHoldersByAssetIds([asset.id])).get(asset.id)).toBe(requester.id);
  });
});

describe("alcance por grupos de soporte (run-3)", () => {
  it("cada agente ve y trabaja solo los tickets de sus grupos; ver todo es el permiso all_view (o admin)", async () => {
    const requester = await user();
    const agentA = await user();
    const agentB = await user();
    const everywhere = await user();
    const admin = await user("admin");
    const chief = await chiefUser();
    const teamA = await group([agentA.id]);
    const teamB = await group([agentB.id]);
    // Estar en todos los grupos ya no convierte a nadie en jefe (run-3, N1).
    await joinAllGroups(everywhere.id);

    const ticket = await ticketService.createTicket(
      { type: "INCIDENT", title: "Sin correo", description: "Outlook no sincroniza", impact: 3, urgency: 3, requesterUserId: requester.id, assignedGroupId: teamA.id },
      { userId: admin.id, isAdmin: true },
      "AGENT",
    );
    createdTickets.add(ticket.id);
    const visibleTo = async (actor: { userId: number; isAdmin?: boolean; roleId?: number }) =>
      (await ticketService.listTickets(PAGE, {}, actor, await resolveTicketScope(actor))).items.map((item) => item.id);

    expect((await resolveTicketScope({ userId: chief.id, roleId: chief.roleId })).all).toBe(true);
    expect((await resolveTicketScope({ userId: everywhere.id })).all).toBe(false);
    expect(await visibleTo({ userId: agentA.id })).toContain(ticket.id);
    expect(await visibleTo({ userId: agentB.id })).not.toContain(ticket.id);
    expect(await visibleTo({ userId: chief.id, roleId: chief.roleId })).toContain(ticket.id);
    expect(await visibleTo({ userId: admin.id, isAdmin: true })).toContain(ticket.id);
    // El jefe trabaja tickets de cualquier grupo.
    await ticketService.addComment(ticket.id, { body: "reviso yo", isPublic: false }, { userId: chief.id, roleId: chief.roleId }, "agent");

    // Fuera de su alcance: 404 en lectura y en cada accion.
    const b = { userId: agentB.id };
    const scopeB = await resolveTicketScope(b);
    await expect(ticketService.getTicketDetail(ticket.id, { audience: "agent", scope: scopeB })).rejects.toBeInstanceOf(NotFoundError);
    await expect(ticketService.addComment(ticket.id, { body: "nota", isPublic: false }, b, "agent")).rejects.toBeInstanceOf(NotFoundError);
    await expect(ticketService.takeTicket(ticket.id, b)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ticketService.changeStatus(ticket.id, { status: "CANCELLED" }, b)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ticketService.assignTicket(ticket.id, { groupId: teamB.id, assigneeUserId: agentB.id }, b)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ticketService.updateClassification(ticket.id, { urgency: 1 }, b)).rejects.toBeInstanceOf(NotFoundError);

    // "Tomar" es atomico y no le quita el ticket a otro agente del mismo grupo.
    const taken = await ticketService.takeTicket(ticket.id, { userId: agentA.id });
    expect(taken).toMatchObject({ status: "IN_PROGRESS", assigneeUserId: agentA.id });
    const agentA2 = await user();
    await replaceGroupMembers(teamA.id, [
      { userId: agentA.id, isLead: false },
      { userId: agentA2.id, isLead: false },
    ]);
    await expect(ticketService.takeTicket(ticket.id, { userId: agentA2.id })).rejects.toBeInstanceOf(ConflictError);

    // Quien sale del grupo suelta sus tickets abiertos y deja de verlos (run-3, N5).
    await replaceGroupMembers(teamA.id, [{ userId: agentA2.id, isLead: false }]);
    const released = await ticketService.getTicketDetail(ticket.id, { audience: "agent" });
    expect(released).toMatchObject({ status: "NEW", assigneeUserId: null });
    expect(await visibleTo({ userId: agentA.id })).not.toContain(ticket.id);

    // Escalado al grupo B: pasa a su cola y A2 deja de verlo.
    await ticketService.assignTicket(ticket.id, { groupId: teamB.id, assigneeUserId: null }, { userId: agentA2.id });
    expect(await visibleTo({ userId: agentA2.id })).not.toContain(ticket.id);
    expect(await visibleTo({ userId: agentB.id })).toContain(ticket.id);
  });

  it("un no-admin no cambia su propia membresia y editar un grupo no lo reactiva (run-3, N1)", async () => {
    const lead = await user();
    const other = await user();
    const team = await group([lead.id]);
    await expect(
      replaceGroupMembers(team.id, [{ userId: lead.id, isLead: true }, { userId: other.id, isLead: false }], { userId: other.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(replaceGroupMembers(team.id, [], { userId: lead.id })).rejects.toBeInstanceOf(ForbiddenError);
    // Cambiar a otros si puede; el admin puede todo.
    await replaceGroupMembers(team.id, [{ userId: lead.id, isLead: true }, { userId: other.id, isLead: false }], { userId: lead.id });
    await replaceGroupMembers(team.id, [{ userId: lead.id, isLead: true }], { userId: other.id, isAdmin: true });

    await updateGroup(team.id, { name: team.name, isActive: false });
    await updateGroup(team.id, { name: `${team.name} renombrado` });
    expect((await getGroupOrThrow(team.id)).isActive).toBe(false);
  });
});

describe("problemas", () => {
  it("error conocido exige workaround y resolver el problema resuelve sus incidentes asignados", async () => {
    const requester = await user();
    const agent = await user();
    const team = await group([agent.id]);
    await joinGroup(agent.id, "Soporte N2");
    const assigned = await incident(requester.id);
    await ticketService.assignTicket(assigned.id, { groupId: team.id, assigneeUserId: agent.id }, { userId: agent.id });
    const unassigned = await incident(requester.id);

    const problem = await problemService.createProblem(
      { title: "Cola de impresion se cuelga", description: "Varios incidentes", impact: 2, urgency: 2, incidentIds: [assigned.id, unassigned.id] },
      agent.id,
    );
    expect(problem.number).toMatch(/^PRB-/);
    expect(problem.incidents).toHaveLength(2);

    await problemService.changeProblemStatus(problem.id, { status: "UNDER_INVESTIGATION" }, agent.id);
    await expect(problemService.changeProblemStatus(problem.id, { status: "KNOWN_ERROR" }, agent.id)).rejects.toBeInstanceOf(BadRequestError);
    await problemService.updateProblem(
      problem.id,
      { title: problem.title, description: problem.description, impact: 2, urgency: 2, rootCause: "Spooler sin memoria", workaround: "Reiniciar el spooler" },
      agent.id,
    );
    await problemService.changeProblemStatus(problem.id, { status: "KNOWN_ERROR" }, agent.id);
    expect(await eventCount(assigned.id, "WORK_NOTE")).toBe(1);

    await problemService.updateProblem(
      problem.id,
      {
        title: problem.title,
        description: problem.description,
        impact: 2,
        urgency: 2,
        rootCause: "Spooler sin memoria",
        workaround: "Reiniciar el spooler",
        permanentFix: "Parche KB500",
      },
      agent.id,
    );
    const result = await problemService.changeProblemStatus(problem.id, { status: "RESOLVED", resolveLinkedIncidents: true }, agent.id);
    expect(result.resolvedIncidents).toEqual([assigned.number]);
    expect(result.skippedIncidents.map((item) => item.number)).toEqual([unassigned.number]);

    const { articleId } = await problemService.createKbDraftFromProblem(problem.id, agent.id);
    const article = await kbService.getArticleOrThrow(articleId);
    expect(article).toMatchObject({ status: "DRAFT", audience: "INTERNAL", sourceProblemId: problem.id });
  });

  it("un incidente no puede pertenecer a dos problemas", async () => {
    const requester = await user();
    const agent = await user();
    const ticket = await incident(requester.id);
    await problemService.createProblem({ title: "Problema uno", description: "Descripcion uno", impact: 2, urgency: 2, incidentIds: [ticket.id] }, agent.id);
    await expect(
      problemService.createProblem({ title: "Problema dos", description: "Descripcion dos", impact: 2, urgency: 2, incidentIds: [ticket.id] }, agent.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("cambios (CAB)", () => {
  const window = () => ({
    plannedStart: new Date(Date.now() + 24 * 3600_000).toISOString(),
    plannedEnd: new Date(Date.now() + 26 * 3600_000).toISOString(),
  });

  it("normal: evaluacion, un rechazo del CAB lo rechaza; emergencia: basta una aprobacion", async () => {
    const requester = await user();
    const cabA = await user("admin");
    const cabB = await user("admin");
    const plain = await user();
    const base = {
      title: "Actualizar firmware switch",
      description: "Version 2.1 del core",
      risk: "MEDIUM" as const,
      impact: 2,
      implementationPlan: "Cargar firmware y reiniciar",
      backoutPlan: "Volver a la version anterior",
      ...window(),
    };

    const normal = await changeService.createChange({ ...base, type: "NORMAL" }, requester.id);
    expect(normal.status).toBe("DRAFT");
    await expect(changeService.runChangeAction(normal.id, { action: "request-approval", approverUserIds: [cabA.id] }, requester.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await changeService.runChangeAction(normal.id, { action: "submit" }, requester.id);
    await expect(
      changeService.runChangeAction(normal.id, { action: "request-approval", approverUserIds: [plain.id] }, requester.id),
    ).rejects.toBeInstanceOf(BadRequestError);
    await changeService.runChangeAction(normal.id, { action: "request-approval", approverUserIds: [cabA.id, cabB.id] }, requester.id);
    let detail = await changeService.decideChange(normal.id, { decision: "APPROVED" }, cabA.id);
    expect(detail.status).toBe("CAB_APPROVAL");
    await expect(changeService.decideChange(normal.id, { decision: "APPROVED" }, plain.id)).rejects.toBeInstanceOf(ForbiddenError);
    detail = await changeService.decideChange(normal.id, { decision: "REJECTED", comment: "Sin ventana de respaldo" }, cabB.id);
    expect(detail.status).toBe("REJECTED");

    const emergency = await changeService.createChange({ ...base, type: "EMERGENCY" }, requester.id);
    await changeService.runChangeAction(emergency.id, { action: "request-approval", approverUserIds: [cabA.id, cabB.id] }, requester.id);
    detail = await changeService.decideChange(emergency.id, { decision: "APPROVED" }, cabA.id);
    expect(detail.status).toBe("SCHEDULED");
    await changeService.runChangeAction(emergency.id, { action: "start" }, requester.id);
    await expect(changeService.runChangeAction(emergency.id, { action: "complete" }, requester.id)).rejects.toBeInstanceOf(BadRequestError);
    await changeService.runChangeAction(emergency.id, { action: "complete", outcome: "SUCCESSFUL" }, requester.id);
    await expect(changeService.runChangeAction(emergency.id, { action: "close" }, requester.id)).rejects.toBeInstanceOf(BadRequestError);
    detail = await changeService.runChangeAction(emergency.id, { action: "close", pirNotes: "Sin impacto" }, requester.id);
    expect(detail.status).toBe("CLOSED");
  });

  it("segregacion en el CAB: nadie se nombra aprobador ni implementa lo que aprobo (run-3, F3)", async () => {
    const requester = await user();
    const manager = await user("admin");
    const cab = await user("admin");
    const change = await changeService.createChange(
      {
        title: "Reinicio de servidor de archivos",
        description: "Aplicar parches del mes",
        risk: "LOW",
        impact: 2,
        implementationPlan: "Parchar y reiniciar",
        backoutPlan: "Restaurar snapshot",
        type: "EMERGENCY",
        ...window(),
      },
      requester.id,
    );
    await expect(
      changeService.runChangeAction(change.id, { action: "request-approval", approverUserIds: [manager.id] }, manager.id),
    ).rejects.toBeInstanceOf(BadRequestError);
    await changeService.runChangeAction(change.id, { action: "request-approval", approverUserIds: [cab.id] }, manager.id);
    expect((await changeService.decideChange(change.id, { decision: "APPROVED" }, cab.id)).status).toBe("SCHEDULED");
    await expect(changeService.runChangeAction(change.id, { action: "start" }, cab.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await changeService.runChangeAction(change.id, { action: "start" }, manager.id)).status).toBe("IMPLEMENTING");
  });

  it("avisa el conflicto de dos cambios sobre el mismo activo en ventanas solapadas", async () => {
    const requester = await user();
    const asset = await heldAsset(requester.id);
    const base = { title: "Mantencion notebook", description: "Reemplazo de disco", risk: "LOW" as const, impact: 3, assetIds: [asset.id], ...window() };
    const first = await changeService.createChange({ ...base, type: "NORMAL", implementationPlan: "a", backoutPlan: "b" }, requester.id);
    await changeService.runChangeAction(first.id, { action: "submit" }, requester.id);
    const second = await changeService.createChange({ ...base, type: "NORMAL" }, requester.id);
    expect(second.conflicts.map((conflict) => conflict.number)).toEqual([first.number]);
  });
});

describe("conocimiento", () => {
  it("publicar exige permiso; el portal solo ve articulos publicos y publicados", async () => {
    const author = await user();
    const reader = await user();
    const internal = await kbService.createArticle(
      { title: "Reiniciar spooler de impresion", body: "Abrir servicios y reiniciar el spooler de impresion de Windows.", audience: "INTERNAL" },
      author.id,
    );
    const shared = await kbService.createArticle(
      { title: "Configurar impresora del piso", body: "Agregar la impresora del piso desde configuracion de Windows.", audience: "PUBLIC" },
      author.id,
    );
    await expect(kbService.changeArticleStatus(shared.id, "PUBLISHED", { userId: author.id, canApprove: false })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await kbService.changeArticleStatus(internal.id, "PUBLISHED", { userId: author.id, canApprove: true });
    const published = await kbService.changeArticleStatus(shared.id, "PUBLISHED", { userId: author.id, canApprove: true });
    expect(published.version).toBe(1);

    const portal = await kbService.searchPublished("impresora", { audience: "PUBLIC", limit: 10 });
    expect(portal.map((article) => article.id)).toEqual([shared.id]);
    await expect(kbService.getPublishedArticle(internal.id, "PUBLIC")).rejects.toBeInstanceOf(NotFoundError);
    const agents = await kbService.searchPublished("impresion spooler", { audience: "INTERNAL", limit: 10, anyTerm: true });
    expect(agents.map((article) => article.id)).toContain(internal.id);

    await kbService.recordFeedback(shared.id, reader.id, true, "PUBLIC");
    await kbService.recordFeedback(shared.id, reader.id, false, "PUBLIC");
    const after = await kbService.getArticleOrThrow(shared.id);
    expect({ yes: after.helpfulYes, no: after.helpfulNo }).toEqual({ yes: 0, no: 1 });
  });
});
