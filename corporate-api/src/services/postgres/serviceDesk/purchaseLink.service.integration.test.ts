import fs from "node:fs";
import { Op, QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../../test/setupIntegration";
import { postgres } from "../../../databases/postgres/connection";
import { getServiceTicketFolder } from "../../../library/documentStorage";
import { BadRequestError, ConflictError, ForbiddenError } from "../../../library/errors";
import { PurchaseRequestModel } from "../../../models/mssql/purchaseRequest.model";
import { PurchaseRequestLineModel } from "../../../models/mssql/purchaseRequestLine.model";
import { PermissionModel } from "../../../models/postgres/permission.model";
import { RoleModel } from "../../../models/postgres/role.model";
import { createPerson, findBeneficiaryByDocumentId } from "../../mssql/person.service";
import { createUser } from "../../mssql/user.service";
import { createProduct } from "../../mongo/product.service";
import { createCostCenter } from "../costCenter.service";
import { hasPermission, setRolePermissions } from "../permission.service";
import { createRole, getRoleByName } from "../role.service";
import { reconcilePurchaseLinkedTickets, syncTicketForPurchaseRequest } from "./purchaseLink.service";
import { createCatalogItem, createGroup, replaceGroupMembers } from "./settings.service";
import * as ticketService from "./ticket.service";

// Solicitud de equipo (plan 010): el portal crea la solicitud de compra (MSSQL)
// junto con el ticket (Postgres) y la compra mueve el ticket. Contra el stack de
// Testing; los items y grupos de prueba llevan el prefijo TEST.
const RESET_TABLES = {
  mssql: ["purchase_request_lines", "purchase_requests", "users", "persons"],
  postgres: ["service_ticket_events", "service_ticket_assets", "service_tickets", "service_desk_counters", "cost_centers"],
  mongo: ["Product"],
};

let seq = 0;
const createdTickets = new Set<number>();

async function cleanupConfig(): Promise<void> {
  await postgres.query(`DELETE FROM service_catalog_items WHERE name LIKE 'TEST %'`);
  await postgres.query(`DELETE FROM support_group_members WHERE group_id IN (SELECT id FROM support_groups WHERE name LIKE 'TEST %')`);
  await postgres.query(`DELETE FROM support_groups WHERE name LIKE 'TEST %'`);
  await RoleModel.destroy({ where: { name: { [Op.like]: "test-sd-eq-%" } } });
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

async function personAndUser(roleId: number) {
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `Equipo${id}`,
    documentId: `TESTDOC-EQ${id}`,
    email: `test-eq-${id}@example.com`,
  });
  const created = await createUser({ personId: person.id, roleId, username: `testeq${id}` });
  return { id: created.id, personId: person.id, roleId, documentId: person.documentId };
}

// Rol de prueba con solo los permisos indicados ("recurso:accion").
async function roleWith(keys: string[]): Promise<number> {
  const permissions = await Promise.all(
    keys.map(async (key) => {
      const [resource, action] = key.split(":");
      const permission = await PermissionModel.findOne({ where: { resource, action } });
      if (!permission) throw new Error(`Falta el permiso sembrado ${key}`);
      return permission.id;
    }),
  );
  const role = await createRole({ name: `test-sd-eq-${++seq}` });
  await setRolePermissions(role.id, permissions);
  return role.id;
}

async function fixture() {
  const admin = await getRoleByName("admin");
  if (!admin) throw new Error('Falta el rol "admin" sembrado');
  const requester = await personAndUser(await roleWith(["generate-ticket:access"]));
  const approver = await personAndUser(admin.id);
  const agent = await personAndUser(admin.id);
  const supportGroup = await createGroup({ name: `TEST Adquisiciones ${++seq}` });
  await replaceGroupMembers(supportGroup.id, [{ userId: agent.id, isLead: false }]);
  const item = await createCatalogItem({
    name: `TEST Equipo ${++seq}`,
    defaultGroupId: supportGroup.id,
    fulfillment: "PURCHASE_REQUEST",
    fields: [{ key: "justificacion", label: "Justificación", type: "textarea", required: true }],
  });
  const costCenter = await createCostCenter({ code: 69000 + ++seq, name: "Centro Equipo" });
  const product = await createProduct({ name: `Notebook EQ ${++seq}`, productType: "COMPRA" });
  return { requester, approver, agent, item, costCenter, productId: String(product._id) };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function equipmentRequest(f: Fixture, overrides: Partial<ticketService.CreateTicketInput> = {}) {
  const ticket = await ticketService.createTicket(
    {
      type: "SERVICE_REQUEST",
      title: "Notebook para nuevo ingreso",
      description: "Ingresa un analista el lunes y necesita equipo",
      impact: 3,
      urgency: 2,
      catalogItemId: f.item.id,
      variables: { justificacion: "Nuevo ingreso" },
      purchaseRequest: {
        costCenterId: f.costCenter.id,
        approverId: f.approver.id,
        lines: [{ productId: f.productId, quantity: 2 }],
      },
      ...overrides,
    },
    { userId: f.requester.id, roleId: f.requester.roleId },
    "PORTAL",
  );
  createdTickets.add(ticket.id);
  return ticket;
}

async function setPurchaseStatus(requestId: number, status: string, updatedBy: number): Promise<void> {
  await PurchaseRequestModel.update({ status, updatedBy }, { where: { id: requestId } });
}

async function eventCount(ticketId: number, eventType: string): Promise<number> {
  const [row] = await postgres.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM service_ticket_events WHERE ticket_id = :ticketId AND event_type = :eventType`,
    { replacements: { ticketId, eventType }, type: QueryTypes.SELECT },
  );
  return row?.total ?? 0;
}

describe("solicitud de equipo: alta combinada", () => {
  it("crea la solicitud de compra con sus lineas y el ticket vinculado, sin aprobacion del Service Desk", async () => {
    const f = await fixture();
    const ticket = await equipmentRequest(f);

    expect(ticket.status).toBe("NEW");
    expect(ticket.slaState).toBe("ON_TRACK");
    expect(ticket.purchaseRequest?.number).toMatch(/^SOL\d{9}$/);
    expect(ticket.purchaseRequest?.status).toBe("DRAFT");
    expect(await eventCount(ticket.id, "PURCHASE_REQUEST_LINKED")).toBe(1);

    const request = await PurchaseRequestModel.findByPk(ticket.purchaseRequest!.id);
    // El solicitante y el beneficiario salen de la sesion, no del cuerpo.
    expect(request?.requesterId).toBe(f.requester.personId);
    expect(request?.beneficiaryId).toBe(f.requester.personId);
    expect(request?.approverId).toBe(f.approver.id);
    const lines = await PurchaseRequestLineModel.findAll({ where: { requestId: request!.id } });
    expect(lines.map((line) => [line.productId, line.quantity])).toEqual([[f.productId, 2]]);
  });

  it("un rol con solo Generar Ticket tiene todo lo que pide la solicitud de equipo", async () => {
    const f = await fixture();
    for (const key of ["purchase-requests:create", "purchase-request-lines:create", "products:read", "product-categories:read"]) {
      const [resource, action] = key.split(":") as [string, "create" | "read"];
      expect(await hasPermission(f.requester.roleId, resource, action)).toBe(true);
    }
  });

  it("si el ticket falla no queda la solicitud de compra", async () => {
    const f = await fixture();
    // impact fuera del CHECK de service_tickets: falla el INSERT en Postgres despues de crear la compra.
    await expect(equipmentRequest(f, { impact: 9 })).rejects.toBeTruthy();
    expect(await PurchaseRequestModel.count()).toBe(0);
    expect(await PurchaseRequestLineModel.count()).toBe(0);
  });

  it("exige los datos de compra, los permisos de compra y un item que genere compra", async () => {
    const f = await fixture();
    await expect(equipmentRequest(f, { purchaseRequest: undefined })).rejects.toBeInstanceOf(BadRequestError);

    const onlyTickets = await personAndUser(await roleWith(["service-tickets:create"]));
    await expect(
      ticketService.createTicket(
        {
          type: "SERVICE_REQUEST",
          title: "Monitor",
          description: "Necesito un monitor adicional",
          impact: 3,
          urgency: 3,
          catalogItemId: f.item.id,
          variables: { justificacion: "Doble pantalla" },
          purchaseRequest: { costCenterId: f.costCenter.id, approverId: f.approver.id, lines: [{ productId: f.productId, quantity: 1 }] },
        },
        { userId: onlyTickets.id, roleId: onlyTickets.roleId },
        "PORTAL",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const plain = await createCatalogItem({ name: `TEST Acceso ${++seq}`, fields: [] });
    await expect(equipmentRequest(f, { catalogItemId: plain.id, variables: {} })).rejects.toBeInstanceOf(BadRequestError);
    expect(await PurchaseRequestModel.count()).toBe(0);
  });

  it("un item que genera compra no admite grupo aprobador", async () => {
    const group = await createGroup({ name: `TEST Aprobadores ${++seq}` });
    await expect(
      createCatalogItem({ name: `TEST Doble ${++seq}`, fulfillment: "PURCHASE_REQUEST", approvalGroupId: group.id, fields: [] }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("solicitud de equipo: la compra mueve el ticket", () => {
  it("OC emitida pausa el SLA, recepcion completa resuelve, y el aviso es idempotente", async () => {
    const f = await fixture();
    const ticket = await equipmentRequest(f);
    const requestId = ticket.purchaseRequest!.id;

    await setPurchaseStatus(requestId, "APPROVED", f.approver.id);
    expect(await syncTicketForPurchaseRequest(requestId)).toBe(true);
    expect(await syncTicketForPurchaseRequest(requestId)).toBe(false);
    expect(await eventCount(ticket.id, "PURCHASE_REQUEST_UPDATED")).toBe(1);

    await setPurchaseStatus(requestId, "OC_GENERATED", f.agent.id);
    await syncTicketForPurchaseRequest(requestId);
    let detail = await ticketService.getTicketDetail(ticket.id, { audience: "agent" });
    expect(detail.status).toBe("ON_HOLD");
    expect(detail.onHoldReason).toBe("AWAITING_VENDOR");
    expect(detail.slaState).toBe("PAUSED");

    await setPurchaseStatus(requestId, "DELIVERED", f.agent.id);
    await syncTicketForPurchaseRequest(requestId);
    detail = await ticketService.getTicketDetail(ticket.id, { audience: "agent" });
    expect(detail.status).toBe("RESOLVED");
    expect(detail.resolutionCode).toBe("FULFILLED");
    expect(detail.autoCloseAt).not.toBeNull();
  });

  it("una compra rechazada anula el ticket", async () => {
    const f = await fixture();
    const ticket = await equipmentRequest(f);
    await setPurchaseStatus(ticket.purchaseRequest!.id, "REJECTED", f.approver.id);
    await syncTicketForPurchaseRequest(ticket.purchaseRequest!.id);
    const detail = await ticketService.getTicketDetail(ticket.id, { audience: "requester", requesterUserId: f.requester.id });
    expect(detail.status).toBe("CANCELLED");
    expect(detail.purchaseRequest?.statusLabel).toBe("Rechazada");
  });

  it("el barrido recupera un cambio de estado que no llego al ticket", async () => {
    const f = await fixture();
    const ticket = await equipmentRequest(f);
    await setPurchaseStatus(ticket.purchaseRequest!.id, "OC_GENERATED", f.agent.id);
    expect(await reconcilePurchaseLinkedTickets()).toBe(1);
    expect(await reconcilePurchaseLinkedTickets()).toBe(0);
    const detail = await ticketService.getTicketDetail(ticket.id, { audience: "agent" });
    expect(detail.status).toBe("ON_HOLD");
  });
});

describe("solicitud de equipo: guardas", () => {
  it("el agente no resuelve ni anula a mano mientras la compra siga en tramite", async () => {
    const f = await fixture();
    const ticket = await equipmentRequest(f);
    await ticketService.takeTicket(ticket.id, { userId: f.agent.id });
    const detail = await ticketService.getTicketDetail(ticket.id, { audience: "agent" });
    expect(detail.allowedTransitions).not.toContain("RESOLVED");
    expect(detail.allowedTransitions).not.toContain("CANCELLED");
    await expect(
      ticketService.changeStatus(ticket.id, { status: "RESOLVED", resolutionCode: "FULFILLED", resolutionNotes: "listo" }, { userId: f.agent.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(ticketService.changeStatus(ticket.id, { status: "CANCELLED" }, { userId: f.agent.id })).rejects.toBeInstanceOf(ConflictError);
  });

  it("el solicitante retira la compra al anular el ticket, solo antes de la aprobacion", async () => {
    const f = await fixture();
    const first = await equipmentRequest(f);
    await ticketService.requesterAction(first.id, "cancel", {}, { userId: f.requester.id });
    expect((await PurchaseRequestModel.findByPk(first.purchaseRequest!.id))?.status).toBe("CANCELLED");
    expect((await ticketService.getTicketDetail(first.id, { audience: "agent" })).status).toBe("CANCELLED");

    const second = await equipmentRequest(f);
    await setPurchaseStatus(second.purchaseRequest!.id, "APPROVED", f.approver.id);
    await syncTicketForPurchaseRequest(second.purchaseRequest!.id);
    await expect(ticketService.requesterAction(second.id, "cancel", {}, { userId: f.requester.id })).rejects.toBeInstanceOf(ConflictError);
    expect((await PurchaseRequestModel.findByPk(second.purchaseRequest!.id))?.status).toBe("APPROVED");
  });

  it("la busqueda del beneficiario devuelve solo id y nombre", async () => {
    const f = await fixture();
    const found = await findBeneficiaryByDocumentId(f.approver.documentId);
    expect(found && Object.keys(found).sort()).toEqual(["fullName", "personId"]);
    expect(found?.personId).toBe(f.approver.personId);
    expect(await findBeneficiaryByDocumentId("NO-EXISTE-999")).toBeNull();
  });
});
