import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../../library/errors";
import type { PaginationParams } from "../../../library/pagination";
import { getOffset } from "../../../library/pagination";
import { getUserByIdOrThrow, getUserDirectory } from "../../mssql/user.service";
import { roleGrantsPermission } from "../permission.service";
import { nextServiceDeskNumber } from "./numbering";
import { emailUsersAbout, fireAndForget, pushTo } from "./notifications";
import { getCategory, isGroupMember } from "./settings.service";
import * as ticketService from "./ticket.service";

// Habilitacion de cambios (plan 009, fase 9D, ITIL v4 "change enablement").
//   STANDARD : plantilla preaprobada -> DRAFT -> SCHEDULED (sin CAB).
//   NORMAL   : DRAFT -> ASSESSMENT -> CAB_APPROVAL (todos aprueban) -> SCHEDULED.
//   EMERGENCY: DRAFT -> CAB_APPROVAL (basta una aprobacion: ECAB) -> SCHEDULED.
// Luego SCHEDULED -> IMPLEMENTING -> REVIEW (resultado + PIR) -> CLOSED.

export const CHANGE_TYPES = ["STANDARD", "NORMAL", "EMERGENCY"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];
export const CHANGE_STATUSES = [
  "DRAFT",
  "ASSESSMENT",
  "CAB_APPROVAL",
  "SCHEDULED",
  "IMPLEMENTING",
  "REVIEW",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
export const CHANGE_RISKS = ["LOW", "MEDIUM", "HIGH"] as const;
export type ChangeRisk = (typeof CHANGE_RISKS)[number];
export const CHANGE_OUTCOMES = ["SUCCESSFUL", "FAILED", "BACKED_OUT"] as const;
export type ChangeOutcome = (typeof CHANGE_OUTCOMES)[number];
export const MAX_CAB_APPROVERS = 10;

// Acciones que el usuario pide explicitamente (la decision del CAB tiene su propio endpoint).
export type ChangeAction = "submit" | "request-approval" | "start" | "complete" | "close" | "cancel";

export function allowedChangeActions(type: ChangeType, status: ChangeStatus): ChangeAction[] {
  switch (status) {
    case "DRAFT":
      return type === "NORMAL" ? ["submit", "cancel"] : type === "EMERGENCY" ? ["request-approval", "cancel"] : ["submit", "cancel"];
    case "ASSESSMENT":
      return ["request-approval", "cancel"];
    case "CAB_APPROVAL":
      return ["cancel"];
    case "SCHEDULED":
      return ["start", "cancel"];
    case "IMPLEMENTING":
      return ["complete"];
    case "REVIEW":
      return ["close"];
    default:
      return [];
  }
}

export interface ChangeSummary {
  id: number;
  number: string;
  type: ChangeType;
  status: ChangeStatus;
  title: string;
  risk: ChangeRisk;
  impact: number;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  assignedGroupId: number | null;
  assignedGroupName: string | null;
  assigneeUserId: number | null;
  assigneeName: string | null;
  requestedBy: number;
  requestedByName: string | null;
  outcome: ChangeOutcome | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChangeApproval {
  approverUserId: number;
  approverName: string | null;
  decision: "APPROVED" | "REJECTED" | null;
  comment: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
}

export interface ChangeConflict {
  id: number;
  number: string;
  title: string;
  status: ChangeStatus;
  plannedStart: Date;
  plannedEnd: Date;
  sharedAssetTags: string[];
}

export interface ChangeDetail extends ChangeSummary {
  description: string;
  justification: string | null;
  categoryId: number | null;
  categoryName: string | null;
  implementationPlan: string | null;
  backoutPlan: string | null;
  testPlan: string | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  pirNotes: string | null;
  problemId: number | null;
  problemNumber: string | null;
  templateId: number | null;
  allowedActions: ChangeAction[];
  approvals: ChangeApproval[];
  assets: { assetId: number; tag: string; statusCode: string }[];
  tickets: { id: number; number: string; title: string; status: string; assignedGroupId: number | null }[];
  conflicts: ChangeConflict[];
  events: { id: number; eventType: string; actorName: string | null; body: string | null; payload: Record<string, unknown>; createdAt: Date }[];
}

const SUMMARY_COLUMNS = `
  c.id, c.number, c.type, c.status, c.title, c.risk, c.impact, c.planned_start AS "plannedStart", c.planned_end AS "plannedEnd",
  c.assigned_group_id AS "assignedGroupId", g.name AS "assignedGroupName", c.assignee_user_id AS "assigneeUserId",
  c.requested_by AS "requestedBy", c.outcome, c.created_at AS "createdAt", c.updated_at AS "updatedAt"
`;
const FROM = `FROM service_changes c LEFT JOIN support_groups g ON g.id = c.assigned_group_id`;

type RawSummary = Omit<ChangeSummary, "assigneeName" | "requestedByName">;

async function withNames<T extends RawSummary>(rows: T[]): Promise<(T & { assigneeName: string | null; requestedByName: string | null })[]> {
  const directory = await getUserDirectory(rows.flatMap((row) => [row.assigneeUserId ?? 0, row.requestedBy]));
  return rows.map((row) => ({
    ...row,
    assigneeName: row.assigneeUserId ? (directory.get(row.assigneeUserId)?.fullName ?? null) : null,
    requestedByName: directory.get(row.requestedBy)?.fullName ?? null,
  }));
}

async function addEvent(
  transaction: Transaction,
  changeId: number,
  eventType: string,
  actorUserId: number | null,
  options: { body?: string | null; payload?: Record<string, unknown> } = {},
): Promise<void> {
  await postgres.query(
    `INSERT INTO service_change_events (change_id, event_type, actor_user_id, body, payload)
     VALUES (:changeId, :eventType, :actorUserId, :body, CAST(:payload AS JSONB))`,
    {
      replacements: { changeId, eventType, actorUserId, body: options.body ?? null, payload: JSON.stringify(options.payload ?? {}) },
      transaction,
    },
  );
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
export async function listChanges(
  params: PaginationParams,
  filters: { statuses?: ChangeStatus[]; includeClosed?: boolean; from?: Date; to?: Date; pendingApprovalFor?: number },
): Promise<{ items: ChangeSummary[]; total: number }> {
  const conditions: string[] = [];
  const replacements: Record<string, unknown> = {};
  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push("c.status IN (:statuses)");
    replacements.statuses = filters.statuses;
  } else if (!filters.includeClosed) {
    conditions.push("c.status NOT IN ('CLOSED','REJECTED','CANCELLED')");
  }
  // Calendario: cambios cuya ventana se cruza con [from, to).
  if (filters.from && filters.to) {
    conditions.push("c.planned_start < :to AND c.planned_end > :from");
    replacements.from = filters.from;
    replacements.to = filters.to;
  }
  if (filters.pendingApprovalFor) {
    conditions.push(
      `c.status = 'CAB_APPROVAL' AND EXISTS (SELECT 1 FROM service_change_approvals a
         WHERE a.change_id = c.id AND a.approver_user_id = :approverId AND a.decision IS NULL)`,
    );
    replacements.approverId = filters.pendingApprovalFor;
  }
  if (params.search) {
    conditions.push("(c.number ILIKE :search OR c.title ILIKE :search)");
    replacements.search = `%${params.search}%`;
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = filters.from ? "c.planned_start ASC" : "c.id DESC";
  const [countRow] = await postgres.query<{ total: number }>(`SELECT COUNT(*)::int AS total ${FROM} ${where}`, {
    replacements,
    type: QueryTypes.SELECT,
  });
  const rows = await postgres.query<RawSummary>(
    `SELECT ${SUMMARY_COLUMNS} ${FROM} ${where} ORDER BY ${order} LIMIT :limit OFFSET :offset`,
    { replacements: { ...replacements, limit: params.limit, offset: getOffset(params) }, type: QueryTypes.SELECT },
  );
  return { items: await withNames(rows), total: countRow?.total ?? 0 };
}

// Otros cambios vivos que tocan alguno de los mismos activos en una ventana solapada.
async function findConflicts(id: number, transaction?: Transaction): Promise<ChangeConflict[]> {
  return postgres.query<ChangeConflict>(
    `SELECT o.id, o.number, o.title, o.status, o.planned_start AS "plannedStart", o.planned_end AS "plannedEnd",
            array_agg(DISTINCT a.tag ORDER BY a.tag) AS "sharedAssetTags"
       FROM service_changes c
       JOIN service_change_assets ca ON ca.change_id = c.id
       JOIN service_change_assets oa ON oa.asset_id = ca.asset_id AND oa.change_id <> c.id
       JOIN service_changes o ON o.id = oa.change_id
       JOIN assets a ON a.id = ca.asset_id
      WHERE c.id = :id AND c.planned_start IS NOT NULL AND c.planned_end IS NOT NULL
        AND o.status IN ('ASSESSMENT','CAB_APPROVAL','SCHEDULED','IMPLEMENTING')
        AND o.planned_start < c.planned_end AND o.planned_end > c.planned_start
      GROUP BY o.id
      ORDER BY o.planned_start`,
    { replacements: { id }, type: QueryTypes.SELECT, transaction },
  );
}

export async function getChangeDetail(id: number): Promise<ChangeDetail> {
  const [row] = await postgres.query<
    RawSummary &
      Omit<ChangeDetail, keyof ChangeSummary | "allowedActions" | "approvals" | "assets" | "tickets" | "conflicts" | "events">
  >(
    `SELECT ${SUMMARY_COLUMNS}, c.description, c.justification, c.category_id AS "categoryId", sc.name AS "categoryName",
            c.implementation_plan AS "implementationPlan", c.backout_plan AS "backoutPlan", c.test_plan AS "testPlan",
            c.actual_start AS "actualStart", c.actual_end AS "actualEnd", c.pir_notes AS "pirNotes",
            c.problem_id AS "problemId", p.number AS "problemNumber", c.template_id AS "templateId"
       ${FROM}
       LEFT JOIN service_categories sc ON sc.id = c.category_id
       LEFT JOIN service_problems p ON p.id = c.problem_id
      WHERE c.id = :id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  if (!row) throw new NotFoundError(`El cambio ${id} no existe`);
  const approvals = await postgres.query<Omit<ChangeApproval, "approverName">>(
    `SELECT approver_user_id AS "approverUserId", decision, comment, requested_at AS "requestedAt", decided_at AS "decidedAt"
       FROM service_change_approvals WHERE change_id = :id ORDER BY id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  const assets = await postgres.query<{ assetId: number; tag: string; statusCode: string }>(
    `SELECT a.id AS "assetId", a.tag, s.code AS "statusCode" FROM service_change_assets l
       JOIN assets a ON a.id = l.asset_id JOIN asset_statuses s ON s.id = a.status_id WHERE l.change_id = :id ORDER BY a.tag`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  const tickets = await postgres.query<ChangeDetail["tickets"][number]>(
    `SELECT t.id, t.number, t.title, t.status, t.assigned_group_id AS "assignedGroupId"
       FROM service_change_tickets l JOIN service_tickets t ON t.id = l.ticket_id
      WHERE l.change_id = :id ORDER BY t.id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  const events = await postgres.query<{ id: number; eventType: string; actorUserId: number | null; body: string | null; payload: Record<string, unknown>; createdAt: Date }>(
    `SELECT id::int AS id, event_type AS "eventType", actor_user_id AS "actorUserId", body, payload, created_at AS "createdAt"
       FROM service_change_events WHERE change_id = :id ORDER BY id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  const directory = await getUserDirectory([
    ...approvals.map((approval) => approval.approverUserId),
    ...events.map((event) => event.actorUserId ?? 0),
  ]);
  const [named] = await withNames([row]);
  return {
    ...named!,
    allowedActions: allowedChangeActions(row.type, row.status),
    approvals: approvals.map((approval) => ({ ...approval, approverName: directory.get(approval.approverUserId)?.fullName ?? null })),
    assets,
    tickets,
    conflicts: await findConflicts(id),
    events: events.map(({ actorUserId, ...event }) => ({
      ...event,
      actorName: actorUserId ? (directory.get(actorUserId)?.fullName ?? `Usuario ${actorUserId}`) : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Alta y edicion
// ---------------------------------------------------------------------------
export interface ChangeInput {
  type: ChangeType;
  title: string;
  description: string;
  justification?: string | null;
  categoryId?: number | null;
  risk: ChangeRisk;
  impact: number;
  implementationPlan?: string | null;
  backoutPlan?: string | null;
  testPlan?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  assignedGroupId?: number | null;
  assigneeUserId?: number | null;
  problemId?: number | null;
  templateId?: number | null;
  assetIds?: number[];
  ticketIds?: number[];
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestError(`Fecha invalida: ${value}`);
  return date;
}

async function validateInput(input: ChangeInput, transaction: Transaction): Promise<{ plannedStart: Date | null; plannedEnd: Date | null }> {
  const plannedStart = toDate(input.plannedStart);
  const plannedEnd = toDate(input.plannedEnd);
  if (plannedStart && plannedEnd && plannedEnd <= plannedStart) throw new BadRequestError("La ventana debe terminar despues de empezar");
  if (input.categoryId) {
    const category = await getCategory(input.categoryId, transaction);
    if (!category?.isActive || !category.appliesTo.includes("CHANGE")) throw new BadRequestError("La categoria no aplica a cambios");
  }
  if (input.assigneeUserId) {
    if (!input.assignedGroupId) throw new BadRequestError("Para asignar un implementador elija tambien su grupo");
    if (!(await isGroupMember(input.assignedGroupId, input.assigneeUserId, transaction))) {
      throw new ConflictError("El implementador no es miembro del grupo elegido");
    }
  }
  if (input.problemId) {
    const [problem] = await postgres.query(`SELECT id FROM service_problems WHERE id = :id`, {
      replacements: { id: input.problemId },
      type: QueryTypes.SELECT,
      transaction,
    });
    if (!problem) throw new BadRequestError("El problema no existe");
  }
  return { plannedStart, plannedEnd };
}

async function replaceLinks(
  changeId: number,
  input: Pick<ChangeInput, "assetIds" | "ticketIds">,
  userId: number,
  transaction: Transaction,
): Promise<void> {
  if (input.assetIds) {
    const ids = [...new Set(input.assetIds)];
    if (ids.length > 0) {
      const found = await postgres.query(`SELECT id FROM assets WHERE id IN (:ids)`, { replacements: { ids }, type: QueryTypes.SELECT, transaction });
      if (found.length !== ids.length) throw new BadRequestError("Algunos activos no existen");
    }
    await postgres.query(`DELETE FROM service_change_assets WHERE change_id = :changeId`, { replacements: { changeId }, transaction });
    for (const assetId of ids) {
      await postgres.query(`INSERT INTO service_change_assets (change_id, asset_id, linked_by) VALUES (:changeId, :assetId, :userId)`, {
        replacements: { changeId, assetId, userId },
        transaction,
      });
    }
  }
  if (input.ticketIds) {
    const ids = [...new Set(input.ticketIds)];
    if (ids.length > 0) {
      const found = await postgres.query(`SELECT id FROM service_tickets WHERE id IN (:ids)`, { replacements: { ids }, type: QueryTypes.SELECT, transaction });
      if (found.length !== ids.length) throw new BadRequestError("Algunos tickets no existen");
    }
    const previous = await postgres.query<{ ticketId: number }>(
      `SELECT ticket_id AS "ticketId" FROM service_change_tickets WHERE change_id = :changeId`,
      { replacements: { changeId }, type: QueryTypes.SELECT, transaction },
    );
    await postgres.query(`DELETE FROM service_change_tickets WHERE change_id = :changeId`, { replacements: { changeId }, transaction });
    for (const ticketId of ids) {
      await postgres.query(`INSERT INTO service_change_tickets (change_id, ticket_id, linked_by) VALUES (:changeId, :ticketId, :userId)`, {
        replacements: { changeId, ticketId, userId },
        transaction,
      });
      if (!previous.some((row) => row.ticketId === ticketId)) {
        await ticketService.addTicketEvent(transaction, ticketId, "LINKED_CHANGE", userId, { payload: { changeId } });
      }
    }
    for (const { ticketId } of previous) {
      if (!ids.includes(ticketId)) {
        await ticketService.addTicketEvent(transaction, ticketId, "UNLINKED_CHANGE", userId, { payload: { changeId } });
      }
    }
  }
}

export async function createChange(input: ChangeInput, userId: number): Promise<ChangeDetail> {
  const id = await postgres.transaction(async (transaction) => {
    let data = input;
    if (input.type === "STANDARD") {
      if (!input.templateId) throw new BadRequestError("Un cambio estandar se crea desde una plantilla preaprobada");
      const [template] = await postgres.query<{ implementationPlan: string; backoutPlan: string; testPlan: string | null; categoryId: number | null; isActive: boolean }>(
        `SELECT implementation_plan AS "implementationPlan", backout_plan AS "backoutPlan", test_plan AS "testPlan",
                category_id AS "categoryId", is_active AS "isActive"
           FROM standard_change_templates WHERE id = :id`,
        { replacements: { id: input.templateId }, type: QueryTypes.SELECT, transaction },
      );
      if (!template?.isActive) throw new BadRequestError("La plantilla no existe o esta inactiva");
      // El cambio estandar hereda el plan aprobado de la plantilla y su riesgo es bajo.
      data = {
        ...input,
        risk: "LOW",
        implementationPlan: template.implementationPlan,
        backoutPlan: template.backoutPlan,
        testPlan: template.testPlan,
        categoryId: input.categoryId ?? template.categoryId,
      };
    } else if (input.templateId) {
      throw new BadRequestError("Solo un cambio estandar usa plantilla");
    }
    const { plannedStart, plannedEnd } = await validateInput(data, transaction);
    const number = await nextServiceDeskNumber("CHG", transaction, data.assignedGroupId ?? null);
    const [row] = await postgres.query<{ id: number }>(
      `INSERT INTO service_changes (number, type, status, title, description, justification, category_id, risk, impact,
                                    implementation_plan, backout_plan, test_plan, planned_start, planned_end, requested_by,
                                    assigned_group_id, assignee_user_id, problem_id, template_id)
       VALUES (:number, :type, 'DRAFT', :title, :description, :justification, :categoryId, :risk, :impact,
               :implementationPlan, :backoutPlan, :testPlan, :plannedStart, :plannedEnd, :userId,
               :assignedGroupId, :assigneeUserId, :problemId, :templateId)
       RETURNING id`,
      {
        replacements: {
          number,
          type: data.type,
          title: data.title,
          description: data.description,
          justification: data.justification ?? null,
          categoryId: data.categoryId ?? null,
          risk: data.risk,
          impact: data.impact,
          implementationPlan: data.implementationPlan ?? null,
          backoutPlan: data.backoutPlan ?? null,
          testPlan: data.testPlan ?? null,
          plannedStart,
          plannedEnd,
          userId,
          assignedGroupId: data.assignedGroupId ?? null,
          assigneeUserId: data.assigneeUserId ?? null,
          problemId: data.problemId ?? null,
          templateId: data.templateId ?? null,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    await addEvent(transaction, row!.id, "CREATED", userId, { payload: { type: data.type } });
    await replaceLinks(row!.id, data, userId, transaction);
    return row!.id;
  });
  return getChangeDetail(id);
}

async function lockChange(id: number, transaction: Transaction) {
  const [row] = await postgres.query<{
    number: string;
    title: string;
    type: ChangeType;
    status: ChangeStatus;
    requestedBy: number;
    assigneeUserId: number | null;
    implementationPlan: string | null;
    backoutPlan: string | null;
    plannedStart: Date | null;
    plannedEnd: Date | null;
    outcome: ChangeOutcome | null;
  }>(
    `SELECT number, title, type, status, requested_by AS "requestedBy", assignee_user_id AS "assigneeUserId",
            implementation_plan AS "implementationPlan", backout_plan AS "backoutPlan", planned_start AS "plannedStart",
            planned_end AS "plannedEnd", outcome
       FROM service_changes WHERE id = :id FOR UPDATE`,
    { replacements: { id }, type: QueryTypes.SELECT, transaction },
  );
  if (!row) throw new NotFoundError(`El cambio ${id} no existe`);
  return row;
}

// Se edita solo antes de pedir aprobacion (despues, lo aprobado no puede cambiar por debajo del CAB).
export async function updateChange(id: number, input: Omit<ChangeInput, "type" | "templateId">, userId: number): Promise<ChangeDetail> {
  await postgres.transaction(async (transaction) => {
    const row = await lockChange(id, transaction);
    if (row.status !== "DRAFT" && row.status !== "ASSESSMENT") {
      throw new ConflictError(`El cambio ${row.number} ya paso a aprobacion: no se edita`);
    }
    const data: ChangeInput = { ...input, type: row.type };
    const { plannedStart, plannedEnd } = await validateInput(data, transaction);
    // En un cambio estandar el plan es el de la plantilla: solo cambian la ventana, la asignacion y los vinculos.
    const planSql =
      row.type === "STANDARD"
        ? ""
        : `, risk = :risk, implementation_plan = :implementationPlan, backout_plan = :backoutPlan, test_plan = :testPlan`;
    await postgres.query(
      `UPDATE service_changes SET title = :title, description = :description, justification = :justification,
              category_id = :categoryId, impact = :impact, planned_start = :plannedStart, planned_end = :plannedEnd,
              assigned_group_id = :assignedGroupId, assignee_user_id = :assigneeUserId, problem_id = :problemId,
              updated_at = now() ${planSql}
        WHERE id = :id`,
      {
        replacements: {
          id,
          title: data.title,
          description: data.description,
          justification: data.justification ?? null,
          categoryId: data.categoryId ?? null,
          impact: data.impact,
          plannedStart,
          plannedEnd,
          assignedGroupId: data.assignedGroupId ?? null,
          assigneeUserId: data.assigneeUserId ?? null,
          problemId: data.problemId ?? null,
          risk: data.risk,
          implementationPlan: data.implementationPlan ?? null,
          backoutPlan: data.backoutPlan ?? null,
          testPlan: data.testPlan ?? null,
        },
        transaction,
      },
    );
    await replaceLinks(id, data, userId, transaction);
    await addEvent(transaction, id, "UPDATED", userId);
  });
  return getChangeDetail(id);
}

// ---------------------------------------------------------------------------
// Flujo
// ---------------------------------------------------------------------------
export interface ChangeActionInput {
  action: ChangeAction;
  approverUserIds?: number[];
  outcome?: ChangeOutcome;
  pirNotes?: string;
  comment?: string;
}

function assertPlan(row: { implementationPlan: string | null; backoutPlan: string | null; plannedStart: Date | null; plannedEnd: Date | null }): void {
  if (!row.implementationPlan?.trim() || !row.backoutPlan?.trim()) {
    throw new BadRequestError("Complete el plan de implementacion y el de reversa");
  }
  if (!row.plannedStart || !row.plannedEnd) throw new BadRequestError("Defina la ventana del cambio (inicio y fin)");
}

export async function runChangeAction(id: number, input: ChangeActionInput, userId: number): Promise<ChangeDetail> {
  const notices: { userIds: number[]; reason: "change-approval-pending"; subject: string }[] = [];
  const outcome = await postgres.transaction(async (transaction) => {
    const row = await lockChange(id, transaction);
    if (!allowedChangeActions(row.type, row.status).includes(input.action)) {
      throw new ConflictError(`La accion ${input.action} no corresponde al estado ${row.status}`);
    }
    let status: ChangeStatus = row.status;
    const sets: string[] = [];
    const replacements: Record<string, unknown> = { id, userId };

    switch (input.action) {
      case "submit":
        assertPlan(row);
        status = row.type === "STANDARD" ? "SCHEDULED" : "ASSESSMENT";
        break;
      case "request-approval": {
        assertPlan(row);
        const approvers = [...new Set(input.approverUserIds ?? [])];
        if (approvers.length === 0) throw new BadRequestError("Elija al menos un aprobador del CAB");
        if (approvers.length > MAX_CAB_APPROVERS) throw new BadRequestError(`Hasta ${MAX_CAB_APPROVERS} aprobadores`);
        // Segregacion de funciones (run-3, F3): no aprueba quien pidio el cambio,
        // quien lo envia a aprobacion ni quien lo va a implementar.
        if (approvers.includes(row.requestedBy)) throw new BadRequestError("Quien solicita el cambio no puede aprobarlo");
        if (approvers.includes(userId)) throw new BadRequestError("No puede nombrarse aprobador de un cambio que usted envia a aprobacion");
        if (row.assigneeUserId !== null && approvers.includes(row.assigneeUserId)) {
          throw new BadRequestError("Quien implementa el cambio no puede aprobarlo");
        }
        for (const approverId of approvers) {
          const user = await getUserByIdOrThrow(approverId);
          if (!user.isActive || !(await roleGrantsPermission(user.roleId, "service-changes", "approve"))) {
            throw new BadRequestError(`El usuario ${approverId} no tiene el permiso para aprobar cambios`);
          }
        }
        // Se reinicia la ronda: las decisiones de una ronda anterior no cuentan.
        await postgres.query(`DELETE FROM service_change_approvals WHERE change_id = :id`, { replacements: { id }, transaction });
        for (const approverId of approvers) {
          await postgres.query(`INSERT INTO service_change_approvals (change_id, approver_user_id) VALUES (:id, :approverId)`, {
            replacements: { id, approverId },
            transaction,
          });
        }
        status = "CAB_APPROVAL";
        notices.push({ userIds: approvers, reason: "change-approval-pending", subject: "Cambio pendiente de su aprobación" });
        break;
      }
      case "start": {
        const [approver] = await postgres.query(
          `SELECT 1 FROM service_change_approvals WHERE change_id = :id AND approver_user_id = :userId AND decision = 'APPROVED'`,
          { replacements: { id, userId }, type: QueryTypes.SELECT, transaction },
        );
        if (approver) throw new ForbiddenError("Quien aprobo el cambio no puede implementarlo");
        status = "IMPLEMENTING";
        sets.push("actual_start = now()");
        break;
      }
      case "complete":
        if (!input.outcome) throw new BadRequestError("Indique el resultado del cambio");
        status = "REVIEW";
        sets.push("actual_end = now()", "outcome = :outcome");
        replacements.outcome = input.outcome;
        break;
      case "close":
        if (row.type !== "STANDARD" && !input.pirNotes?.trim()) {
          throw new BadRequestError("Registre la revision post implementacion (PIR) antes de cerrar");
        }
        status = "CLOSED";
        sets.push("pir_notes = :pirNotes", "closed_at = now()", "closed_by = :userId");
        replacements.pirNotes = input.pirNotes?.trim() || null;
        break;
      case "cancel":
        status = "CANCELLED";
        sets.push("closed_at = now()", "closed_by = :userId");
        break;
    }

    sets.push("status = :status", "updated_at = now()");
    replacements.status = status;
    await postgres.query(`UPDATE service_changes SET ${sets.join(", ")} WHERE id = :id`, { replacements, transaction });
    await addEvent(transaction, id, "STATUS_CHANGED", userId, {
      body: input.pirNotes?.trim() || input.comment?.trim() || null,
      payload: { from: row.status, to: status, action: input.action, outcome: input.outcome ?? null },
    });

    // Al cerrar, los tickets vinculados quedan con la nota del resultado.
    if (status === "CLOSED") {
      const linked = await postgres.query<{ ticketId: number }>(
        `SELECT ticket_id AS "ticketId" FROM service_change_tickets WHERE change_id = :id`,
        { replacements: { id }, type: QueryTypes.SELECT, transaction },
      );
      const [closed] = await postgres.query<{ outcome: string }>(`SELECT outcome FROM service_changes WHERE id = :id`, {
        replacements: { id },
        type: QueryTypes.SELECT,
        transaction,
      });
      for (const { ticketId } of linked) {
        await ticketService.addTicketEvent(transaction, ticketId, "WORK_NOTE", userId, {
          body: `Cambio ${row.number} cerrado. Resultado: ${closed?.outcome ?? "-"}`,
          payload: { changeId: id },
        });
      }
    }
    return row;
  });

  const record = { id, number: outcome.number, title: outcome.title };
  for (const notice of notices) {
    pushTo(notice.userIds, notice.reason, record);
    fireAndForget(() => emailUsersAbout(notice.userIds, record, notice.subject, "Revise el cambio en Gestión de Tickets › Cambios."));
  }
  return getChangeDetail(id);
}

export async function decideChange(
  id: number,
  input: { decision: "APPROVED" | "REJECTED"; comment?: string },
  userId: number,
): Promise<ChangeDetail> {
  const outcome = await postgres.transaction(async (transaction) => {
    const row = await lockChange(id, transaction);
    if (row.status !== "CAB_APPROVAL") throw new ConflictError(`El cambio ${row.number} no esta en aprobacion`);
    if (input.decision === "REJECTED" && !input.comment?.trim()) throw new BadRequestError("Explique el motivo del rechazo");
    const [approval] = await postgres.query<{ decision: string | null }>(
      `SELECT decision FROM service_change_approvals WHERE change_id = :id AND approver_user_id = :userId FOR UPDATE`,
      { replacements: { id, userId }, type: QueryTypes.SELECT, transaction },
    );
    if (!approval) throw new ForbiddenError("No fue designado como aprobador de este cambio");
    if (userId === row.requestedBy || userId === row.assigneeUserId) {
      throw new ForbiddenError("Quien solicita o implementa el cambio no puede aprobarlo");
    }
    if (approval.decision) throw new ConflictError("Ya registro su decision");
    await postgres.query(
      `UPDATE service_change_approvals SET decision = :decision, comment = :comment, decided_at = now()
        WHERE change_id = :id AND approver_user_id = :userId`,
      { replacements: { id, userId, decision: input.decision, comment: input.comment?.trim() || null }, transaction },
    );
    await addEvent(transaction, id, "APPROVAL_DECIDED", userId, { body: input.comment?.trim() || null, payload: { decision: input.decision } });

    const [tally] = await postgres.query<{ approved: number; rejected: number; total: number }>(
      `SELECT COUNT(*) FILTER (WHERE decision = 'APPROVED')::int AS approved,
              COUNT(*) FILTER (WHERE decision = 'REJECTED')::int AS rejected, COUNT(*)::int AS total
         FROM service_change_approvals WHERE change_id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction },
    );
    let status: ChangeStatus | null = null;
    if ((tally?.rejected ?? 0) > 0) status = "REJECTED";
    else if (row.type === "EMERGENCY" ? (tally?.approved ?? 0) >= 1 : tally?.approved === tally?.total) status = "SCHEDULED";
    if (status) {
      await postgres.query(
        `UPDATE service_changes SET status = :status, updated_at = now() ${status === "REJECTED" ? ", closed_at = now(), closed_by = :userId" : ""}
          WHERE id = :id`,
        { replacements: { id, status, userId }, transaction },
      );
      await addEvent(transaction, id, "STATUS_CHANGED", null, { payload: { from: "CAB_APPROVAL", to: status, origin: "cab" } });
    }
    return { row, status };
  });
  if (outcome.status) {
    const record = { id, number: outcome.row.number, title: outcome.row.title };
    const targets = [outcome.row.requestedBy, outcome.row.assigneeUserId];
    pushTo(targets, "ticket-updated", record);
    fireAndForget(() =>
      emailUsersAbout(targets, record, outcome.status === "SCHEDULED" ? "Cambio aprobado y programado" : "Cambio rechazado por el CAB", input.comment ?? ""),
    );
  }
  return getChangeDetail(id);
}

export async function countPendingChangeApprovals(userId: number): Promise<number> {
  const [row] = await postgres.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM service_change_approvals a JOIN service_changes c ON c.id = a.change_id
      WHERE a.approver_user_id = :userId AND a.decision IS NULL AND c.status = 'CAB_APPROVAL'`,
    { replacements: { userId }, type: QueryTypes.SELECT },
  );
  return row?.total ?? 0;
}

// ---------------------------------------------------------------------------
// Plantillas de cambio estandar
// ---------------------------------------------------------------------------
export interface ChangeTemplate {
  id: number;
  name: string;
  description: string | null;
  categoryId: number | null;
  implementationPlan: string;
  backoutPlan: string;
  testPlan: string | null;
  isActive: boolean;
}

const TEMPLATE_COLUMNS = `id, name, description, category_id AS "categoryId", implementation_plan AS "implementationPlan",
  backout_plan AS "backoutPlan", test_plan AS "testPlan", is_active AS "isActive"`;

export async function listTemplates(options: { activeOnly?: boolean } = {}): Promise<ChangeTemplate[]> {
  return postgres.query<ChangeTemplate>(
    `SELECT ${TEMPLATE_COLUMNS} FROM standard_change_templates ${options.activeOnly ? "WHERE is_active" : ""} ORDER BY name`,
    { type: QueryTypes.SELECT },
  );
}

export type TemplateInput = Omit<ChangeTemplate, "id" | "isActive"> & { isActive?: boolean };

export async function saveTemplate(id: number | null, input: TemplateInput): Promise<ChangeTemplate> {
  const replacements = {
    id,
    name: input.name,
    description: input.description ?? null,
    categoryId: input.categoryId ?? null,
    implementationPlan: input.implementationPlan,
    backoutPlan: input.backoutPlan,
    testPlan: input.testPlan ?? null,
    isActive: input.isActive ?? true,
  };
  try {
    const [row] = await postgres.query<ChangeTemplate>(
      id === null
        ? `INSERT INTO standard_change_templates (name, description, category_id, implementation_plan, backout_plan, test_plan, is_active)
           VALUES (:name, :description, :categoryId, :implementationPlan, :backoutPlan, :testPlan, :isActive) RETURNING ${TEMPLATE_COLUMNS}`
        : `UPDATE standard_change_templates SET name = :name, description = :description, category_id = :categoryId,
                  implementation_plan = :implementationPlan, backout_plan = :backoutPlan, test_plan = :testPlan,
                  is_active = :isActive, updated_at = now()
            WHERE id = :id RETURNING ${TEMPLATE_COLUMNS}`,
      { replacements, type: QueryTypes.SELECT },
    );
    if (!row) throw new NotFoundError(`La plantilla ${id} no existe`);
    return row;
  } catch (err) {
    if (err instanceof Error && err.name === "SequelizeUniqueConstraintError") throw new ConflictError(`Ya existe la plantilla ${input.name}`);
    if (err instanceof Error && err.name === "SequelizeForeignKeyConstraintError") throw new BadRequestError("La categoria no existe");
    throw err;
  }
}
