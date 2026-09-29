import { QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../../test/setupIntegration";
import { postgres } from "../../../databases/postgres/connection";
import { BadRequestError, ConflictError, ForbiddenError } from "../../../library/errors";
import { createPerson } from "../../mssql/person.service";
import { createUser } from "../../mssql/user.service";
import { createCostCenter } from "../costCenter.service";
import { getRoleByName } from "../role.service";
import { createCatalogItem, createGroup, replaceGroupMembers } from "../serviceDesk/settings.service";
import * as ticketService from "../serviceDesk/ticket.service";
import { sweepExpiredRoomAccesses } from "./accessSweeper";
import { createRoom, updateRoom, updateSettings } from "./commRoom.service";
import { listGrants, listMultiRoomHolders, revokeGrant } from "./roomAccess.service";
import { checkIn, checkOut } from "./roomEntry.service";

// Acceso a salas de comunicaciones (plan 016) contra el stack de Testing: ticket -> validacion del
// Service Desk -> aprobacion del responsable -> registro de acceso -> ingresos y expiracion.
const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: [
    "comm_room_entries",
    "comm_room_access_grants",
    "comm_room_access_requests",
    "comm_rooms",
    "service_ticket_approvals",
    "service_ticket_events",
    "service_tickets",
    "service_desk_counters",
    "cost_centers",
  ],
};

let seq = 0;
const PAGE = { page: 1, limit: 50, sortBy: "id", sortOrder: "desc" as const };
const HOUR = 3_600_000;

async function cleanupConfig(): Promise<void> {
  await postgres.query(`DELETE FROM service_catalog_items WHERE name LIKE 'TEST %'`);
  await postgres.query(`DELETE FROM support_groups WHERE name LIKE 'TEST %'`);
  await updateSettings({ temporaryMaxActiveDays: 30 }, 1);
}

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
  await cleanupConfig();
});

afterEach(async () => {
  await resetTestData(RESET_TABLES);
  await cleanupConfig();
});

async function user() {
  const role = await getRoleByName("user");
  if (!role) throw new Error("Falta el rol user");
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `Sala${id}`,
    documentId: `${20000000 + id}-K`,
    email: `test-sala-${id}@example.com`,
  });
  const created = await createUser({ personId: person.id, roleId: role.id, username: `testsala${id}` });
  return { id: created.id, documentId: person.documentId, name: `Test Sala${id}` };
}

async function group(members: number[]) {
  const created = await createGroup({ name: `TEST Grupo ${++seq}` });
  await replaceGroupMembers(created.id, members.map((userId) => ({ userId, isLead: false })));
  return created;
}

// Escenario base: solicitante, agente del grupo que atiende, aprobador del grupo responsable, una sala.
async function scenario() {
  const [requester, agent, approver, outsider] = [await user(), await user(), await user(), await user()];
  const agents = await group([agent.id]);
  const approvers = await group([approver.id]);
  const item = await createCatalogItem({
    name: `TEST Acceso sala ${++seq}`,
    defaultGroupId: agents.id,
    approvalGroupId: approvers.id,
    fulfillment: "ROOM_ACCESS",
    fields: [],
  });
  const costCenter = await createCostCenter({ code: 5000 + ++seq, name: `TEST Tienda ${seq}` });
  const room = await createRoom({ name: "Sala rack", costCenterId: costCenter.id, address: "Av. Siempre Viva 123" }, agent.id);
  return { requester, agent, approver, outsider, agents, approvers, item, costCenter, room };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;

function requestFor(s: Scenario, beneficiary: ticketService.CreateTicketInput["roomAccess"] extends infer R ? (R extends { beneficiary: infer B } ? B : never) : never) {
  return {
    type: "SERVICE_REQUEST" as const,
    title: "Acceso a sala rack",
    description: "Mantención del switch",
    impact: 3,
    urgency: 2,
    catalogItemId: s.item.id,
    roomAccess: {
      roomId: s.room.id,
      beneficiary,
      reason: "Cambio de switch core",
      requestedType: "TEMPORARY" as const,
      requestedFrom: new Date().toISOString(),
      requestedUntil: new Date(Date.now() + 8 * HOUR).toISOString(),
    },
  };
}

async function openTicket(s: Scenario) {
  return ticketService.createTicket(
    requestFor(s, { kind: "EXTERNAL", fullName: "Juan Técnico", documentId: "12.345.678-k", company: "Redes SpA" }),
    { userId: s.requester.id },
    "PORTAL",
  );
}

async function validate(s: Scenario, ticketId: number, overrides: Partial<{ accessType: "TEMPORARY" | "PERMANENT" | "SINGLE_USE"; validFrom: string; validUntil: string | null }> = {}) {
  return ticketService.submitRoomAccessForApproval(
    ticketId,
    {
      roomId: s.room.id,
      accessType: "TEMPORARY",
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      validUntil: new Date(Date.now() + 4 * HOUR).toISOString(),
      notes: "Verificado con el jefe de tienda",
      ...overrides,
    },
    { userId: s.agent.id },
  );
}

async function approvedGrant(s: Scenario, overrides: Parameters<typeof validate>[2] = {}) {
  const ticket = await openTicket(s);
  await ticketService.takeTicket(ticket.id, { userId: s.agent.id });
  await validate(s, ticket.id, overrides);
  await ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: s.approver.id });
  const { items } = await listGrants(PAGE, { ticketNumber: ticket.number });
  return { ticket, grant: items[0]! };
}

describe("acceso a sala por ticket (plan 016)", () => {
  it("el ticket nace NEW sin aprobacion, con la solicitud y el RUT normalizado", async () => {
    const s = await scenario();
    const ticket = await openTicket(s);
    expect(ticket.status).toBe("NEW");
    expect(ticket.approvalGroupId).toBeNull();
    expect(ticket.roomAccess?.status).toBe("REQUESTED");
    expect(ticket.roomAccess?.beneficiaryDocumentId).toBe("12345678-K");
    expect(ticket.allowedTransitions).not.toContain("RESOLVED");
  });

  it("un colaborador se resuelve por RUT exacto; un RUT desconocido o un externo sin empresa se rechazan", async () => {
    const s = await scenario();
    const beneficiary = await user();
    const ticket = await ticketService.createTicket(
      requestFor(s, { kind: "INTERNAL", documentId: beneficiary.documentId }),
      { userId: s.requester.id },
      "PORTAL",
    );
    expect(ticket.roomAccess?.beneficiaryName).toBe(beneficiary.name);
    await expect(
      ticketService.createTicket(requestFor(s, { kind: "INTERNAL", documentId: "99999999-9" }), { userId: s.requester.id }, "PORTAL"),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("el item de sala exige los datos del acceso y otro item no los acepta", async () => {
    const s = await scenario();
    const { roomAccess: _omit, ...withoutRoom } = requestFor(s, { kind: "INTERNAL", documentId: s.requester.documentId });
    await expect(ticketService.createTicket(withoutRoom, { userId: s.requester.id }, "PORTAL")).rejects.toBeInstanceOf(BadRequestError);
    const plain = await createCatalogItem({ name: `TEST Otro ${++seq}`, fields: [] });
    await expect(
      ticketService.createTicket(
        { ...requestFor(s, { kind: "INTERNAL", documentId: s.requester.documentId }), catalogItemId: plain.id },
        { userId: s.requester.id },
        "PORTAL",
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("validar exige ticket tomado y reglas de periodo; luego queda PENDING_APPROVAL con el SLA en pausa", async () => {
    const s = await scenario();
    const ticket = await openTicket(s);
    await expect(validate(s, ticket.id)).rejects.toBeInstanceOf(ConflictError);
    await ticketService.takeTicket(ticket.id, { userId: s.agent.id });
    await expect(validate(s, ticket.id, { accessType: "PERMANENT" })).rejects.toBeInstanceOf(BadRequestError);
    await expect(validate(s, ticket.id, { validUntil: null })).rejects.toBeInstanceOf(BadRequestError);

    const { detail } = await validate(s, ticket.id);
    expect(detail.status).toBe("PENDING_APPROVAL");
    expect(detail.approvalGroupId).toBe(s.approvers.id);
    expect(detail.onHoldSince).not.toBeNull();
    expect(detail.roomAccess?.status).toBe("VALIDATED");
    await expect(validate(s, ticket.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("separacion de funciones: ni alguien fuera del grupo, ni el solicitante, ni quien valido aprueban", async () => {
    const s = await scenario();
    const ticket = await openTicket(s);
    await ticketService.takeTicket(ticket.id, { userId: s.agent.id });
    await validate(s, ticket.id);
    await expect(ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: s.outsider.id })).rejects.toBeInstanceOf(ForbiddenError);
    // El agente que valido tambien es miembro del grupo aprobador: igual no puede aprobar.
    await replaceGroupMembers(s.approvers.id, [
      { userId: s.approver.id, isLead: false },
      { userId: s.agent.id, isLead: false },
      { userId: s.requester.id, isLead: false },
    ]);
    await expect(ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: s.agent.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: s.requester.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("aprobar crea el registro de acceso vigente y resuelve el ticket", async () => {
    const s = await scenario();
    const { ticket, grant } = await approvedGrant(s);
    const detail = await ticketService.getTicketDetail(ticket.id, { audience: "agent" });
    expect(detail.status).toBe("RESOLVED");
    expect(detail.resolutionCode).toBe("FULFILLED");
    expect(detail.onHoldSince).toBeNull();
    expect(detail.roomAccess?.status).toBe("APPROVED");
    expect(grant.status).toBe("ACTIVE");
    expect(grant.isValidNow).toBe(true);
    expect(grant.approvedBy).toBe(s.approver.id);
    expect(grant.validatedBy).toBe(s.agent.id);
    expect(grant.reason).toBe("Cambio de switch core");
  });

  it("rechazar exige motivo, anula el ticket y no crea acceso", async () => {
    const s = await scenario();
    const ticket = await openTicket(s);
    await ticketService.takeTicket(ticket.id, { userId: s.agent.id });
    await validate(s, ticket.id);
    await expect(ticketService.decideApproval(ticket.id, { decision: "REJECTED" }, { userId: s.approver.id })).rejects.toBeInstanceOf(BadRequestError);
    await ticketService.decideApproval(ticket.id, { decision: "REJECTED", comment: "No corresponde" }, { userId: s.approver.id });
    const detail = await ticketService.getTicketDetail(ticket.id, { audience: "agent" });
    expect(detail.status).toBe("CANCELLED");
    expect(detail.roomAccess?.status).toBe("REJECTED");
    expect((await listGrants(PAGE, {})).total).toBe(0);
  });

  it("el solicitante anula en espera de aprobacion y la solicitud queda anulada", async () => {
    const s = await scenario();
    const ticket = await openTicket(s);
    await ticketService.takeTicket(ticket.id, { userId: s.agent.id });
    await validate(s, ticket.id);
    await ticketService.requesterAction(ticket.id, "cancel", {}, { userId: s.requester.id });
    const detail = await ticketService.getTicketDetail(ticket.id, { audience: "agent" });
    expect(detail.status).toBe("CANCELLED");
    expect(detail.roomAccess?.status).toBe("CANCELLED");
  });

  it("el agente no resuelve a mano un acceso sin aprobar", async () => {
    const s = await scenario();
    const ticket = await openTicket(s);
    await ticketService.takeTicket(ticket.id, { userId: s.agent.id });
    await expect(
      ticketService.changeStatus(ticket.id, { status: "RESOLVED", resolutionCode: "FULFILLED", resolutionNotes: "Listo" }, { userId: s.agent.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("regresion: un item con aprobacion al crear sigue igual", async () => {
    const s = await scenario();
    const item = await createCatalogItem({ name: `TEST Licencia ${++seq}`, approvalGroupId: s.approvers.id, fields: [] });
    const ticket = await ticketService.createTicket(
      { type: "SERVICE_REQUEST", title: "Licencia", description: "Visio", impact: 3, urgency: 3, catalogItemId: item.id },
      { userId: s.requester.id },
      "PORTAL",
    );
    expect(ticket.status).toBe("PENDING_APPROVAL");
    const approved = await ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: s.approver.id });
    expect(approved.status).toBe("NEW");
  });
});

describe("ingresos a la sala (plan 016)", () => {
  it("registra ingreso y salida con acceso vigente; ya adentro o sin acceso se rechaza", async () => {
    const s = await scenario();
    const { grant } = await approvedGrant(s);
    await expect(checkIn({ roomId: s.room.id, documentId: "11111111-1" }, s.agent.id)).rejects.toBeInstanceOf(ConflictError);
    const entry = await checkIn({ roomId: s.room.id, documentId: "12345678-k" }, s.agent.id);
    expect(entry.grantId).toBe(grant.id);
    expect(entry.beneficiaryName).toBe("Juan Técnico");
    await expect(checkIn({ roomId: s.room.id, documentId: "12345678-K" }, s.agent.id)).rejects.toBeInstanceOf(ConflictError);
    const out = await checkOut(entry.id, s.agent.id);
    expect(out.checkedOutAt).not.toBeNull();
    await expect(checkOut(entry.id, s.agent.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("dos ingresos simultaneos con el mismo acceso: solo uno pasa", async () => {
    const s = await scenario();
    await approvedGrant(s);
    const results = await Promise.allSettled([
      checkIn({ roomId: s.room.id, documentId: "12345678-K" }, s.agent.id),
      checkIn({ roomId: s.room.id, documentId: "12345678-K" }, s.agent.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("un acceso de unica vez se usa una sola vez y expira con la salida", async () => {
    const s = await scenario();
    const { grant } = await approvedGrant(s, { accessType: "SINGLE_USE" });
    const entry = await checkIn({ roomId: s.room.id, documentId: "12345678-K" }, s.agent.id);
    await checkOut(entry.id, s.agent.id);
    const [after] = (await listGrants(PAGE, { roomId: s.room.id })).items;
    expect(after?.id).toBe(grant.id);
    expect(after?.status).toBe("EXPIRED");
    await expect(checkIn({ roomId: s.room.id, documentId: "12345678-K" }, s.agent.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("un acceso revocado o vencido no deja ingresar; revocar exige un acceso activo", async () => {
    const s = await scenario();
    const { grant } = await approvedGrant(s);
    await revokeGrant(grant.id, "Termino el contrato", s.agent.id);
    await expect(revokeGrant(grant.id, "Otra vez", s.agent.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(checkIn({ roomId: s.room.id, documentId: "12345678-K" }, s.agent.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("expiracion y reportes (plan 016)", () => {
  it("el barrido expira lo vencido una sola vez y no toca los permanentes", async () => {
    const s = await scenario();
    const { grant } = await approvedGrant(s);
    const { grant: permanent } = await approvedGrant(s, { accessType: "PERMANENT", validUntil: null });
    await postgres.query(`UPDATE comm_room_access_grants SET valid_until = now() - interval '1 minute' WHERE id = :id`, {
      replacements: { id: grant.id },
    });
    expect(await sweepExpiredRoomAccesses()).toBe(1);
    expect(await sweepExpiredRoomAccesses()).toBe(0);
    const statuses = await postgres.query<{ id: number; status: string }>(`SELECT id, status FROM comm_room_access_grants ORDER BY id`, {
      type: QueryTypes.SELECT,
    });
    expect(statuses).toEqual([
      { id: grant.id, status: "EXPIRED" },
      { id: permanent.id, status: "ACTIVE" },
    ]);
    expect((await listGrants(PAGE, { roomId: s.room.id, validNow: true })).items.map((item) => item.id)).toEqual([permanent.id]);
  });

  it("personas con acceso a varias tiendas y temporales prolongados", async () => {
    const s = await scenario();
    await approvedGrant(s);
    const otherCostCenter = await createCostCenter({ code: 6000 + ++seq, name: `TEST Tienda ${seq}` });
    const otherRoom = await createRoom({ name: "Sala B", costCenterId: otherCostCenter.id, address: "Calle 2" }, s.agent.id);
    const ticket = await ticketService.createTicket(
      { ...requestFor(s, { kind: "EXTERNAL", fullName: "Juan Técnico", documentId: "12345678-K", company: "Redes SpA" }), roomAccess: { ...requestFor(s, { kind: "EXTERNAL", fullName: "Juan Técnico", documentId: "12345678-K", company: "Redes SpA" }).roomAccess, roomId: otherRoom.id } },
      { userId: s.requester.id },
      "PORTAL",
    );
    await ticketService.takeTicket(ticket.id, { userId: s.agent.id });
    await ticketService.submitRoomAccessForApproval(
      ticket.id,
      { roomId: otherRoom.id, accessType: "TEMPORARY", validFrom: new Date(Date.now() - 40 * 24 * HOUR).toISOString(), validUntil: new Date(Date.now() + HOUR).toISOString() },
      { userId: s.agent.id },
    );
    await ticketService.decideApproval(ticket.id, { decision: "APPROVED" }, { userId: s.approver.id });

    const holders = await listMultiRoomHolders("costCenter", 2);
    expect(holders).toHaveLength(1);
    expect(holders[0]?.beneficiaryDocumentId).toBe("12345678-K");
    expect(holders[0]?.places).toBe(2);

    const long = await listGrants(PAGE, { longTemporary: true });
    expect(long.items.map((item) => item.roomId)).toEqual([otherRoom.id]);
  });

  it("una sala con accesos activos no se desactiva", async () => {
    const s = await scenario();
    await approvedGrant(s);
    await expect(
      updateRoom(s.room.id, { name: "Sala rack", costCenterId: s.costCenter.id, address: "Av. Siempre Viva 123", isActive: false }, s.agent.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
