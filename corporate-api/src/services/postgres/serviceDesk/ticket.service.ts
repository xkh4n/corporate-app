import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { deleteIfExists, getServiceTicketFolder, saveBuffer } from "../../../library/documentStorage";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../../library/errors";
import type { PaginationParams } from "../../../library/pagination";
import { getOffset } from "../../../library/pagination";
import { addBusinessMinutes, businessMinutesBetween } from "../../../library/serviceDesk/businessTime";
import {
  agentTransitionsFrom,
  buildVariablesSchema,
  canAgentTransition,
  canRequesterCancel,
  FINAL_STATUSES,
  resolvePriority,
  SLA_WARNING_RATIO,
  type Channel,
  type OnHoldReason,
  type Priority,
  type ResolutionCode,
  type TicketStatus,
  type TicketType,
} from "../../../library/serviceDesk/ticketRules";
import { getUserByIdOrThrow, getUserDirectory } from "../../mssql/user.service";
import { nextServiceDeskNumber } from "./numbering";
import {
  emailRequester,
  emailUsersAbout,
  fireAndForget,
  notifyGroup,
  pushTo,
  type NotifiableRecord,
} from "./notifications";
import {
  getCatalogItem,
  getCategory,
  getSlaPolicy,
  isGroupMember,
  listGroupIdsOfUser,
  loadBusinessCalendar,
  loadPriorityMatrix,
} from "./settings.service";
import {
  assertNoAssetInSupport,
  linkAssetsInTransaction,
  listTicketAssets,
  type TicketAsset,
} from "./ticketAsset.service";
import {
  assertTicketInScope,
  isPendingApprovalFor,
  isTicketInScope,
  resolveTicketScope,
  ticketScopeCondition,
  type TicketScope,
} from "./ticketScope";

// Incidentes y solicitudes de servicio (plan 009, ITIL v4). Cada cambio:
// SELECT ... FOR UPDATE del ticket + evento insert-only en la misma
// transaccion; los avisos (push y correo) salen despues del commit.

export const MAX_TICKET_ATTACHMENTS = 20;
// Tiempo en minutos habiles tras el que un ticket RESUELTO se cierra solo si
// el solicitante no lo reabre: 3 jornadas de 9 horas.
export const AUTO_CLOSE_BUSINESS_MINUTES = 3 * 9 * 60;
// Sin .eml/.msg: un correo adjunto es un vector de phishing hacia los agentes (run-3, F7).
const ATTACHMENT_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

export interface TicketActor {
  userId: number;
  // Admin (bypass de RBAC) y rol: definen el alcance por grupos (ticketScope.ts).
  isAdmin?: boolean;
  roleId?: number;
}

export type SlaState = "NONE" | "ON_TRACK" | "AT_RISK" | "BREACHED" | "PAUSED" | "MET";

interface TicketRow {
  id: number;
  number: string;
  type: TicketType;
  status: TicketStatus;
  onHoldReason: OnHoldReason | null;
  title: string;
  description: string;
  categoryId: number | null;
  catalogItemId: number | null;
  variables: Record<string, unknown>;
  impact: number;
  urgency: number;
  priority: Priority;
  channel: Channel;
  isMajor: boolean;
  requesterUserId: number;
  openedBy: number;
  assignedGroupId: number | null;
  assigneeUserId: number | null;
  parentTicketId: number | null;
  resolutionCode: ResolutionCode | null;
  resolutionNotes: string | null;
  calendarId: number | null;
  slaStartAt: Date | null;
  responseMinutes: number | null;
  resolutionMinutes: number | null;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
  resolutionWarnAt: Date | null;
  slaPausedMinutes: number;
  onHoldSince: Date | null;
  firstResponseAt: Date | null;
  responseBreached: boolean;
  resolutionBreached: boolean;
  warnedAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: number | null;
  autoCloseAt: Date | null;
  closedAt: Date | null;
  closedBy: number | null;
  reopenCount: number;
  csatScore: number | null;
  csatComment: string | null;
  problemId: number | null;
  approvalGroupId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const ROW_COLUMNS = `
  t.id, t.number, t.type, t.status, t.on_hold_reason AS "onHoldReason", t.title, t.description,
  t.category_id AS "categoryId", t.catalog_item_id AS "catalogItemId", t.variables, t.impact, t.urgency,
  t.priority, t.channel, t.is_major AS "isMajor", t.requester_user_id AS "requesterUserId", t.opened_by AS "openedBy",
  t.assigned_group_id AS "assignedGroupId", t.assignee_user_id AS "assigneeUserId", t.parent_ticket_id AS "parentTicketId",
  t.resolution_code AS "resolutionCode", t.resolution_notes AS "resolutionNotes", t.calendar_id AS "calendarId",
  t.sla_start_at AS "slaStartAt", t.response_minutes AS "responseMinutes", t.resolution_minutes AS "resolutionMinutes",
  t.response_due_at AS "responseDueAt", t.resolution_due_at AS "resolutionDueAt", t.resolution_warn_at AS "resolutionWarnAt",
  t.sla_paused_minutes AS "slaPausedMinutes", t.on_hold_since AS "onHoldSince", t.first_response_at AS "firstResponseAt",
  t.response_breached AS "responseBreached", t.resolution_breached AS "resolutionBreached", t.warned_at AS "warnedAt",
  t.approval_group_id AS "approvalGroupId",
  t.resolved_at AS "resolvedAt", t.resolved_by AS "resolvedBy", t.auto_close_at AS "autoCloseAt",
  t.closed_at AS "closedAt", t.closed_by AS "closedBy", t.reopen_count AS "reopenCount",
  t.csat_score AS "csatScore", t.csat_comment AS "csatComment", t.problem_id AS "problemId",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt"
`;

export interface TicketSummary {
  id: number;
  number: string;
  type: TicketType;
  status: TicketStatus;
  onHoldReason: OnHoldReason | null;
  title: string;
  priority: Priority;
  impact: number;
  urgency: number;
  isMajor: boolean;
  channel: Channel;
  categoryId: number | null;
  categoryName: string | null;
  catalogItemId: number | null;
  catalogItemName: string | null;
  requesterUserId: number;
  requesterName: string;
  assignedGroupId: number | null;
  assignedGroupName: string | null;
  assigneeUserId: number | null;
  assigneeName: string | null;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
  firstResponseAt: Date | null;
  slaState: SlaState;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketEvent {
  id: number;
  eventType: string;
  actorUserId: number | null;
  actorName: string | null;
  isPublic: boolean;
  body: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface TicketAttachment {
  id: number;
  isPublic: boolean;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: number;
  uploadedByName: string | null;
  createdAt: Date;
}

export interface TicketApproval {
  approverUserId: number;
  approverName: string | null;
  decision: "APPROVED" | "REJECTED";
  comment: string | null;
  decidedAt: Date;
}

export interface TicketDetail extends TicketSummary {
  description: string;
  variables: Record<string, unknown>;
  resolutionCode: ResolutionCode | null;
  resolutionNotes: string | null;
  resolutionWarnAt: Date | null;
  responseBreached: boolean;
  resolutionBreached: boolean;
  onHoldSince: Date | null;
  autoCloseAt: Date | null;
  reopenCount: number;
  csatScore: number | null;
  csatComment: string | null;
  parentTicketId: number | null;
  problemId: number | null;
  approvalGroupId: number | null;
  events: TicketEvent[];
  attachments: TicketAttachment[];
  approvals: TicketApproval[];
  assets: TicketAsset[];
  // Solo para el agente: transiciones permitidas desde el estado actual.
  allowedTransitions: TicketStatus[];
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function recordOf(row: Pick<TicketRow, "id" | "number" | "title">): NotifiableRecord {
  return { id: row.id, number: row.number, title: row.title };
}

export function computeSlaState(row: {
  status: TicketStatus;
  slaStartAt: Date | null;
  resolutionDueAt: Date | null;
  resolutionWarnAt: Date | null;
  resolutionBreached: boolean;
}): SlaState {
  if (!row.slaStartAt || row.status === "PENDING_APPROVAL") return "NONE";
  if (row.status === "CANCELLED") return "NONE";
  if (row.status === "RESOLVED" || row.status === "CLOSED") return row.resolutionBreached ? "BREACHED" : "MET";
  if (row.status === "ON_HOLD") return row.resolutionBreached ? "BREACHED" : "PAUSED";
  const now = Date.now();
  if (row.resolutionBreached || (row.resolutionDueAt && new Date(row.resolutionDueAt).getTime() < now)) return "BREACHED";
  if (row.resolutionWarnAt && new Date(row.resolutionWarnAt).getTime() < now) return "AT_RISK";
  return "ON_TRACK";
}

async function addEvent(
  transaction: Transaction,
  ticketId: number,
  eventType: string,
  actorUserId: number | null,
  options: { isPublic?: boolean; body?: string | null; payload?: Record<string, unknown> } = {},
): Promise<number> {
  const [row] = await postgres.query<{ id: number }>(
    `INSERT INTO service_ticket_events (ticket_id, event_type, actor_user_id, is_public, body, payload)
     VALUES (:ticketId, :eventType, :actorUserId, :isPublic, :body, CAST(:payload AS JSONB)) RETURNING id`,
    {
      replacements: {
        ticketId,
        eventType,
        actorUserId,
        isPublic: options.isPublic ?? false,
        body: options.body ?? null,
        payload: JSON.stringify(options.payload ?? {}),
      },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  return Number(row!.id);
}

export { addEvent as addTicketEvent };

async function lockTicket(id: number, transaction: Transaction): Promise<TicketRow> {
  const [row] = await postgres.query<TicketRow>(`SELECT ${ROW_COLUMNS} FROM service_tickets t WHERE t.id = :id FOR UPDATE`, {
    replacements: { id },
    type: QueryTypes.SELECT,
    transaction,
  });
  if (!row) throw new NotFoundError(`El ticket ${id} no existe`);
  return row;
}

export { lockTicket as lockServiceTicket };

// Bloquea el ticket y exige que este dentro del alcance del agente (sus grupos).
async function lockWorkableTicket(id: number, actor: TicketActor, transaction: Transaction): Promise<TicketRow> {
  const row = await lockTicket(id, transaction);
  assertTicketInScope(await resolveTicketScope(actor, transaction), row);
  return row;
}

async function assertActiveGroup(groupId: number, transaction: Transaction): Promise<void> {
  const [group] = await postgres.query<{ isActive: boolean }>(`SELECT is_active AS "isActive" FROM support_groups WHERE id = :id`, {
    replacements: { id: groupId },
    type: QueryTypes.SELECT,
    transaction,
  });
  if (!group?.isActive) throw new BadRequestError("El grupo no existe o esta inactivo");
}

async function findRow(id: number, transaction?: Transaction): Promise<TicketRow | null> {
  const [row] = await postgres.query<TicketRow>(`SELECT ${ROW_COLUMNS} FROM service_tickets t WHERE t.id = :id`, {
    replacements: { id },
    type: QueryTypes.SELECT,
    transaction,
  });
  return row ?? null;
}

// Fechas del SLA desde el inicio del reloj, con los minutos pausados sumados
// al vencimiento de resolucion (la respuesta no se pausa).
async function computeSlaDates(
  type: TicketType,
  priority: Priority,
  slaStartAt: Date,
  pausedMinutes: number,
  transaction: Transaction,
): Promise<{
  calendarId: number;
  responseMinutes: number;
  resolutionMinutes: number;
  responseDueAt: Date;
  resolutionDueAt: Date;
  resolutionWarnAt: Date;
}> {
  const policy = await getSlaPolicy(type, priority, transaction);
  if (!policy) throw new ConflictError(`No hay politica de SLA para ${type} ${priority}: configurela en el Service Desk`);
  const { id: calendarId, calendar } = await loadBusinessCalendar(policy.calendarId, transaction);
  return {
    calendarId,
    responseMinutes: policy.responseMinutes,
    resolutionMinutes: policy.resolutionMinutes,
    responseDueAt: addBusinessMinutes(slaStartAt, policy.responseMinutes, calendar),
    resolutionDueAt: addBusinessMinutes(slaStartAt, policy.resolutionMinutes + pausedMinutes, calendar),
    resolutionWarnAt: addBusinessMinutes(
      slaStartAt,
      Math.round(policy.resolutionMinutes * SLA_WARNING_RATIO) + pausedMinutes,
      calendar,
    ),
  };
}

async function applySlaDates(ticketId: number, slaStartAt: Date, dates: Awaited<ReturnType<typeof computeSlaDates>>, transaction: Transaction): Promise<void> {
  const now = Date.now();
  await postgres.query(
    `UPDATE service_tickets SET sla_start_at = :slaStartAt, calendar_id = :calendarId,
            response_minutes = :responseMinutes, resolution_minutes = :resolutionMinutes,
            response_due_at = :responseDueAt, resolution_due_at = :resolutionDueAt, resolution_warn_at = :resolutionWarnAt,
            -- Si el nuevo vencimiento quedo en el futuro, el aviso puede volver a dispararse.
            warned_at = CASE WHEN :warnInFuture THEN NULL ELSE warned_at END,
            response_breached = CASE WHEN first_response_at IS NULL THEN :responseOverdue
                                     ELSE first_response_at > :responseDueAt END,
            resolution_breached = CASE WHEN resolved_at IS NOT NULL THEN resolved_at > :resolutionDueAt
                                       WHEN status IN ('NEW','ASSIGNED','IN_PROGRESS') THEN :resolutionOverdue
                                       ELSE resolution_breached END,
            updated_at = now()
      WHERE id = :ticketId`,
    {
      replacements: {
        ticketId,
        slaStartAt,
        ...dates,
        warnInFuture: dates.resolutionWarnAt.getTime() > now,
        responseOverdue: dates.responseDueAt.getTime() < now,
        resolutionOverdue: dates.resolutionDueAt.getTime() < now,
      },
      transaction,
    },
  );
}

async function startSla(row: Pick<TicketRow, "id" | "type" | "priority">, transaction: Transaction): Promise<void> {
  const startAt = new Date();
  const dates = await computeSlaDates(row.type, row.priority, startAt, 0, transaction);
  await applySlaDates(row.id, startAt, dates, transaction);
}

async function markFirstResponse(row: TicketRow, transaction: Transaction): Promise<void> {
  if (row.firstResponseAt || !row.slaStartAt) return;
  await postgres.query(
    `UPDATE service_tickets SET first_response_at = now(),
            response_breached = (response_due_at IS NOT NULL AND now() > response_due_at)
      WHERE id = :id AND first_response_at IS NULL`,
    { replacements: { id: row.id }, transaction },
  );
}

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------
export interface CreateTicketInput {
  type: TicketType;
  title: string;
  description: string;
  categoryId?: number | null;
  catalogItemId?: number | null;
  variables?: Record<string, unknown>;
  impact: number;
  urgency: number;
  assetIds?: number[];
  // Solo agentes (registro por telefono, presencial, etc.).
  channel?: Channel;
  requesterUserId?: number;
  assignedGroupId?: number | null;
  isMajor?: boolean;
}

export async function createTicket(
  input: CreateTicketInput,
  actor: TicketActor,
  mode: "PORTAL" | "AGENT",
): Promise<TicketDetail> {
  const requesterUserId = mode === "AGENT" && input.requesterUserId ? input.requesterUserId : actor.userId;
  if (requesterUserId !== actor.userId && !(await getUserByIdOrThrow(requesterUserId)).isActive) {
    throw new BadRequestError("El solicitante esta inactivo");
  }

  const created = await postgres.transaction(async (transaction) => {
    const category = input.categoryId ? await getCategory(input.categoryId, transaction) : null;
    if (input.categoryId && (!category || !category.isActive)) throw new BadRequestError("La categoria no existe o esta inactiva");
    if (category && !category.appliesTo.includes(input.type)) {
      throw new BadRequestError(`La categoria ${category.name} no aplica a este tipo de ticket`);
    }

    const catalogItem = input.catalogItemId ? await getCatalogItem(input.catalogItemId, transaction) : null;
    if (input.catalogItemId && (!catalogItem || !catalogItem.isActive)) {
      throw new BadRequestError("El item del catalogo no existe o esta inactivo");
    }
    if (catalogItem && input.type !== "SERVICE_REQUEST") {
      throw new BadRequestError("Un item del catalogo solo se pide como solicitud de servicio");
    }
    if (mode === "PORTAL" && input.type === "SERVICE_REQUEST" && !catalogItem) {
      throw new BadRequestError("Elija el servicio del catalogo que necesita");
    }
    let variables: Record<string, unknown> = {};
    if (catalogItem) {
      const parsed = buildVariablesSchema(catalogItem.fields).safeParse(input.variables ?? {});
      if (!parsed.success) {
        throw new BadRequestError("Revise los datos del formulario del servicio", parsed.error.issues);
      }
      variables = parsed.data;
    } else if (input.variables && Object.keys(input.variables).length > 0) {
      throw new BadRequestError("Solo una solicitud del catalogo lleva datos de formulario");
    }

    // Grupo: el que indica el agente, o el del servicio, o el de la categoria.
    let assignedGroupId: number | null =
      mode === "AGENT" && input.assignedGroupId !== undefined
        ? input.assignedGroupId
        : (catalogItem?.defaultGroupId ?? category?.defaultGroupId ?? null);
    if (assignedGroupId === null && category?.parentId) {
      assignedGroupId = (await getCategory(category.parentId, transaction))?.defaultGroupId ?? null;
    }
    if (mode === "AGENT" && input.assignedGroupId) await assertActiveGroup(input.assignedGroupId, transaction);

    const categoryId = category?.id ?? catalogItem?.categoryId ?? null;
    const priority = resolvePriority(await loadPriorityMatrix(transaction), input.impact, input.urgency);
    const needsApproval = catalogItem?.approvalGroupId !== null && catalogItem?.approvalGroupId !== undefined;
    const status: TicketStatus = needsApproval ? "PENDING_APPROVAL" : "NEW";
    const number = await nextServiceDeskNumber(input.type === "INCIDENT" ? "INC" : "REQ", transaction);

    const [row] = await postgres.query<{ id: number }>(
      `INSERT INTO service_tickets (number, type, status, title, description, category_id, catalog_item_id, variables,
                                    impact, urgency, priority, channel, is_major, requester_user_id, opened_by,
                                    assigned_group_id, approval_group_id)
       VALUES (:number, :type, :status, :title, :description, :categoryId, :catalogItemId, CAST(:variables AS JSONB),
               :impact, :urgency, :priority, :channel, :isMajor, :requesterUserId, :openedBy, :assignedGroupId, :approvalGroupId)
       RETURNING id`,
      {
        replacements: {
          number,
          type: input.type,
          status,
          title: input.title,
          description: input.description,
          categoryId,
          catalogItemId: catalogItem?.id ?? null,
          variables: JSON.stringify(variables),
          impact: input.impact,
          urgency: input.urgency,
          priority,
          channel: mode === "PORTAL" ? "PORTAL" : (input.channel ?? "AGENT"),
          isMajor: mode === "AGENT" && input.isMajor === true && priority === "P1",
          requesterUserId,
          openedBy: actor.userId,
          assignedGroupId,
          // Fijado al crear: cambiar despues el item del catalogo no cambia quien aprueba (run-3 final, L6).
          approvalGroupId: needsApproval ? catalogItem!.approvalGroupId : null,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    const id = row!.id;
    await addEvent(transaction, id, "CREATED", actor.userId, {
      isPublic: true,
      payload: { status, priority, assignedGroupId, channel: mode === "PORTAL" ? "PORTAL" : (input.channel ?? "AGENT") },
    });
    if (status === "NEW") await startSla({ id, type: input.type, priority }, transaction);
    if (input.assetIds && input.assetIds.length > 0) {
      await linkAssetsInTransaction(id, input.assetIds, actor.userId, { ownOnlyFor: mode === "PORTAL" ? actor.userId : null }, transaction);
    }
    return { id, number, status, assignedGroupId, approvalGroupId: catalogItem?.approvalGroupId ?? null, priority };
  });

  const record: NotifiableRecord = { id: created.id, number: created.number, title: input.title };
  fireAndForget(async () => {
    await emailRequester(
      requesterUserId,
      record,
      "Registramos su ticket",
      created.status === "PENDING_APPROVAL"
        ? "Su solicitud quedó registrada y está esperando aprobación."
        : `Su ticket quedó registrado con prioridad ${created.priority}. Le avisaremos de cada avance.`,
    );
    if (created.status === "PENDING_APPROVAL") {
      await notifyGroup(created.approvalGroupId, "ticket-approval-pending", record, "Solicitud pendiente de aprobación", "Hay una solicitud esperando su aprobación.", { allMembers: true });
    } else {
      await notifyGroup(created.assignedGroupId, "ticket-assigned", record, "Nuevo ticket en la cola del grupo", `Nuevo ticket ${created.priority} en la cola del grupo.`, {
        allMembers: created.priority === "P1",
      });
    }
  });
  return getTicketDetail(created.id, { audience: "agent" });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
export type QueueView = "all" | "mine" | "my-groups" | "unassigned" | "breached" | "pending-approval";

export interface TicketListFilters {
  view?: QueueView;
  statuses?: TicketStatus[];
  type?: TicketType;
  priority?: Priority;
  groupId?: number;
  requesterUserId?: number;
  assetId?: number;
  problemId?: number;
  includeClosed?: boolean;
}

const SORT_COLUMNS: Record<string, string> = {
  id: "t.id",
  createdAt: "t.created_at",
  updatedAt: "t.updated_at",
  priority: "t.priority",
  resolutionDueAt: "t.resolution_due_at",
  number: "t.number",
};
export const TICKET_SORT_FIELDS = Object.keys(SORT_COLUMNS);

const LIST_FROM = `
  FROM service_tickets t
  LEFT JOIN service_categories c ON c.id = t.category_id
  LEFT JOIN service_catalog_items ci ON ci.id = t.catalog_item_id
  LEFT JOIN support_groups g ON g.id = t.assigned_group_id
`;

type ListRow = TicketRow & { categoryName: string | null; catalogItemName: string | null; assignedGroupName: string | null };

async function withNames(rows: ListRow[]): Promise<TicketSummary[]> {
  const directory = await getUserDirectory(rows.flatMap((row) => [row.requesterUserId, row.assigneeUserId ?? 0]));
  return rows.map((row) => toSummary(row, directory));
}

function toSummary(row: ListRow, directory: Map<number, { fullName: string }>): TicketSummary {
  return {
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    onHoldReason: row.onHoldReason,
    title: row.title,
    priority: row.priority,
    impact: row.impact,
    urgency: row.urgency,
    isMajor: row.isMajor,
    channel: row.channel,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    catalogItemId: row.catalogItemId,
    catalogItemName: row.catalogItemName,
    requesterUserId: row.requesterUserId,
    requesterName: directory.get(row.requesterUserId)?.fullName ?? `Usuario ${row.requesterUserId}`,
    assignedGroupId: row.assignedGroupId,
    assignedGroupName: row.assignedGroupName,
    assigneeUserId: row.assigneeUserId,
    assigneeName: row.assigneeUserId ? (directory.get(row.assigneeUserId)?.fullName ?? `Usuario ${row.assigneeUserId}`) : null,
    responseDueAt: row.responseDueAt,
    resolutionDueAt: row.resolutionDueAt,
    firstResponseAt: row.firstResponseAt,
    slaState: computeSlaState(row),
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// scope: alcance del agente (cola de /service-tickets); sin scope no se filtra
// por grupo (portal, que filtra por solicitante, y listados internos).
export async function listTickets(
  params: PaginationParams,
  filters: TicketListFilters,
  actor: TicketActor,
  scope?: TicketScope,
): Promise<{ items: TicketSummary[]; total: number }> {
  const conditions: string[] = [];
  const replacements: Record<string, unknown> = {};
  const scopeCondition = scope ? ticketScopeCondition(scope, replacements, { withApprovals: true }) : null;
  if (scopeCondition) conditions.push(scopeCondition);

  switch (filters.view ?? "all") {
    case "mine":
      conditions.push("t.assignee_user_id = :actorId");
      replacements.actorId = actor.userId;
      break;
    case "my-groups": {
      const groupIds = await listGroupIdsOfUser(actor.userId);
      if (groupIds.length === 0) return { items: [], total: 0 };
      conditions.push("t.assigned_group_id IN (:groupIds)");
      replacements.groupIds = groupIds;
      break;
    }
    case "unassigned":
      conditions.push("t.assignee_user_id IS NULL");
      break;
    case "breached":
      conditions.push(
        `(t.resolution_breached OR t.response_breached OR (t.status IN ('NEW','ASSIGNED','IN_PROGRESS') AND t.resolution_due_at < now()))`,
      );
      break;
    case "pending-approval":
      conditions.push("t.status = 'PENDING_APPROVAL'");
      break;
    default:
      break;
  }

  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push("t.status IN (:statuses)");
    replacements.statuses = filters.statuses;
  } else if (!filters.includeClosed && filters.view !== "pending-approval") {
    // Por defecto la cola muestra lo vivo: sin cerrados ni anulados.
    conditions.push("t.status NOT IN ('CLOSED','CANCELLED')");
  }
  if (filters.type) {
    conditions.push("t.type = :type");
    replacements.type = filters.type;
  }
  if (filters.priority) {
    conditions.push("t.priority = :priority");
    replacements.priority = filters.priority;
  }
  if (filters.groupId) {
    conditions.push("t.assigned_group_id = :groupId");
    replacements.groupId = filters.groupId;
  }
  if (filters.requesterUserId) {
    conditions.push("t.requester_user_id = :requesterUserId");
    replacements.requesterUserId = filters.requesterUserId;
  }
  if (filters.assetId) {
    conditions.push("EXISTS (SELECT 1 FROM service_ticket_assets sta WHERE sta.ticket_id = t.id AND sta.asset_id = :assetId)");
    replacements.assetId = filters.assetId;
  }
  if (filters.problemId) {
    conditions.push("t.problem_id = :problemId");
    replacements.problemId = filters.problemId;
  }
  if (params.search) {
    conditions.push("(t.number ILIKE :search OR t.title ILIKE :search)");
    replacements.search = `%${params.search}%`;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderColumn = SORT_COLUMNS[params.sortBy] ?? "t.id";
  const order = `${orderColumn} ${params.sortOrder === "asc" ? "ASC" : "DESC"} NULLS LAST, t.id DESC`;

  const [countRow] = await postgres.query<{ total: number }>(`SELECT COUNT(*)::int AS total ${LIST_FROM} ${where}`, {
    replacements,
    type: QueryTypes.SELECT,
  });
  const rows = await postgres.query<ListRow>(
    `SELECT ${ROW_COLUMNS}, c.name AS "categoryName", ci.name AS "catalogItemName", g.name AS "assignedGroupName"
       ${LIST_FROM} ${where} ORDER BY ${order} LIMIT :limit OFFSET :offset`,
    { replacements: { ...replacements, limit: params.limit, offset: getOffset(params) }, type: QueryTypes.SELECT },
  );
  return { items: await withNames(rows), total: countRow?.total ?? 0 };
}

export interface DetailOptions {
  audience: "agent" | "requester";
  // Para el solicitante: el ticket debe ser suyo (si no, 404: no se revela que existe).
  requesterUserId?: number;
  // Para el agente: su alcance por grupos (si no lo cubre, 404).
  scope?: TicketScope;
}

export async function getTicketDetail(id: number, options: DetailOptions): Promise<TicketDetail> {
  const [row] = await postgres.query<ListRow>(
    `SELECT ${ROW_COLUMNS}, c.name AS "categoryName", ci.name AS "catalogItemName", g.name AS "assignedGroupName"
       ${LIST_FROM} WHERE t.id = :id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  if (!row || (options.audience === "requester" && row.requesterUserId !== options.requesterUserId)) {
    throw new NotFoundError(`El ticket ${id} no existe`);
  }
  // Fuera de sus grupos, un aprobador lee la solicitud pendiente como el solicitante: sin lo interno.
  const approverOnly = options.audience === "agent" && !!options.scope && !isTicketInScope(options.scope, row);
  if (approverOnly) assertTicketInScope(options.scope!, row, { withApprovals: true });
  const publicOnly = options.audience === "requester" || approverOnly;

  const events = await postgres.query<Omit<TicketEvent, "actorName">>(
    `SELECT id::int AS id, event_type AS "eventType", actor_user_id AS "actorUserId", is_public AS "isPublic", body, payload,
            created_at AS "createdAt"
       FROM service_ticket_events WHERE ticket_id = :id ${publicOnly ? "AND is_public" : ""} ORDER BY id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  const attachments = await postgres.query<Omit<TicketAttachment, "uploadedByName">>(
    `SELECT id, is_public AS "isPublic", original_name AS "originalName", mime_type AS "mimeType", size_bytes AS "sizeBytes",
            uploaded_by AS "uploadedBy", created_at AS "createdAt"
       FROM service_ticket_attachments WHERE ticket_id = :id ${publicOnly ? "AND is_public" : ""} ORDER BY id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  const approvals = await postgres.query<Omit<TicketApproval, "approverName">>(
    `SELECT approver_user_id AS "approverUserId", decision, comment, decided_at AS "decidedAt"
       FROM service_ticket_approvals WHERE ticket_id = :id ORDER BY decided_at`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  const assets = await listTicketAssets(id);

  const directory = await getUserDirectory([
    row.requesterUserId,
    row.assigneeUserId ?? 0,
    ...events.map((event) => event.actorUserId ?? 0),
    ...attachments.map((attachment) => attachment.uploadedBy),
    ...approvals.map((approval) => approval.approverUserId),
  ]);
  const nameOf = (userId: number | null) => (userId ? (directory.get(userId)?.fullName ?? `Usuario ${userId}`) : null);

  return {
    ...toSummary(row, directory),
    description: row.description,
    variables: row.variables,
    resolutionCode: row.resolutionCode,
    resolutionNotes: row.resolutionNotes,
    resolutionWarnAt: row.resolutionWarnAt,
    responseBreached: row.responseBreached,
    resolutionBreached: row.resolutionBreached,
    onHoldSince: row.onHoldSince,
    autoCloseAt: row.autoCloseAt,
    reopenCount: row.reopenCount,
    csatScore: row.csatScore,
    csatComment: row.csatComment,
    parentTicketId: row.parentTicketId,
    problemId: row.problemId,
    approvalGroupId: row.approvalGroupId,
    events: events.map((event) => ({ ...event, actorName: nameOf(event.actorUserId) })),
    attachments: attachments.map((attachment) => ({ ...attachment, uploadedByName: nameOf(attachment.uploadedBy) })),
    approvals: approvals.map((approval) => ({ ...approval, approverName: nameOf(approval.approverUserId) })),
    assets,
    allowedTransitions: publicOnly ? [] : [...agentTransitionsFrom(row.status)],
  };
}

// ---------------------------------------------------------------------------
// Trabajo del agente
// ---------------------------------------------------------------------------
export interface AssignInput {
  groupId: number | null;
  assigneeUserId: number | null;
}

export async function assignTicket(id: number, input: AssignInput, actor: TicketActor): Promise<TicketDetail> {
  if (input.assigneeUserId !== null && input.groupId === null) {
    throw new BadRequestError("Para asignar un agente elija tambien su grupo");
  }
  const outcome = await postgres.transaction(async (transaction) => {
    const row = await lockWorkableTicket(id, actor, transaction);
    if (FINAL_STATUSES.includes(row.status) || row.status === "RESOLVED") {
      throw new ConflictError(`El ticket ${row.number} esta ${row.status}: no se reasigna`);
    }
    if (input.groupId !== null) await assertActiveGroup(input.groupId, transaction);
    if (input.assigneeUserId !== null && !(await isGroupMember(input.groupId!, input.assigneeUserId, transaction))) {
      throw new ConflictError("El agente no es miembro del grupo elegido");
    }
    const groupChanged = input.groupId !== row.assignedGroupId;
    const assigneeChanged = input.assigneeUserId !== row.assigneeUserId;
    if (!groupChanged && !assigneeChanged) return { row, groupChanged, assigneeChanged };

    if (input.assigneeUserId === null && row.assigneeUserId !== null && row.status === "ON_HOLD") {
      throw new ConflictError("Retome el ticket antes de devolverlo a la cola");
    }
    // NEW -> ASSIGNED al tener agente; sin agente, vuelve a la cola (NEW).
    let status = row.status;
    if (input.assigneeUserId !== null && row.status === "NEW") status = "ASSIGNED";
    if (input.assigneeUserId === null && (row.status === "ASSIGNED" || row.status === "IN_PROGRESS")) status = "NEW";

    await postgres.query(
      `UPDATE service_tickets SET assigned_group_id = :groupId, assignee_user_id = :assigneeUserId, status = :status,
              updated_at = now() WHERE id = :id`,
      { replacements: { id, groupId: input.groupId, assigneeUserId: input.assigneeUserId, status }, transaction },
    );
    await addEvent(transaction, id, groupChanged ? "ESCALATED" : "ASSIGNED", actor.userId, {
      isPublic: true,
      payload: {
        fromGroupId: row.assignedGroupId,
        toGroupId: input.groupId,
        fromAssigneeUserId: row.assigneeUserId,
        toAssigneeUserId: input.assigneeUserId,
      },
    });
    if (input.assigneeUserId !== null) await markFirstResponse(row, transaction);
    return { row, groupChanged, assigneeChanged };
  });

  const record = recordOf(outcome.row);
  if (outcome.assigneeChanged && input.assigneeUserId !== null && input.assigneeUserId !== actor.userId) {
    pushTo([input.assigneeUserId], "ticket-assigned", record);
    fireAndForget(() => emailUsersAbout([input.assigneeUserId], record, "Se le asignó un ticket", "Tiene un ticket nuevo asignado."));
  }
  if (outcome.groupChanged && input.assigneeUserId === null) {
    fireAndForget(() => notifyGroup(input.groupId, "ticket-assigned", record, "Ticket escalado al grupo", "Se escaló un ticket a la cola del grupo."));
  }
  if (outcome.groupChanged || outcome.assigneeChanged) pushTo([outcome.row.requesterUserId], "ticket-updated", record);
  return getTicketDetail(id, { audience: "agent" });
}

// "Tomar": el agente se asigna el ticket de un grupo al que pertenece y lo pone
// en curso, todo en una transaccion. No le quita el ticket a otro agente: eso
// es una reasignacion (run-3, F9).
export async function takeTicket(id: number, actor: TicketActor): Promise<TicketDetail> {
  const outcome = await postgres.transaction(async (transaction) => {
    const row = await lockWorkableTicket(id, actor, transaction);
    if (!["NEW", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(row.status)) {
      throw new ConflictError(`El ticket ${row.number} esta ${row.status}: no se puede tomar`);
    }
    if (row.assigneeUserId !== null && row.assigneeUserId !== actor.userId) {
      throw new ConflictError("El ticket ya lo atiende otro agente: pida la reasignacion");
    }
    let groupId = row.assignedGroupId;
    if (groupId === null || !(await isGroupMember(groupId, actor.userId, transaction))) {
      if (groupId !== null) throw new ConflictError("El ticket esta en la cola de otro grupo: escalelo o pida la reasignacion");
      const [first] = await postgres.query<{ groupId: number }>(
        `SELECT m.group_id AS "groupId" FROM support_group_members m JOIN support_groups g ON g.id = m.group_id
          WHERE m.user_id = :userId AND g.is_active ORDER BY m.group_id LIMIT 1`,
        { replacements: { userId: actor.userId }, type: QueryTypes.SELECT, transaction },
      );
      if (!first) throw new ConflictError("No pertenece a ningun grupo de soporte: pida que lo agreguen a uno");
      groupId = first.groupId;
    }
    const changed = row.assigneeUserId !== actor.userId || groupId !== row.assignedGroupId;
    if (changed) {
      const status: TicketStatus = row.status === "NEW" ? "ASSIGNED" : row.status;
      await postgres.query(
        `UPDATE service_tickets SET assigned_group_id = :groupId, assignee_user_id = :userId, status = :status,
                updated_at = now() WHERE id = :id`,
        { replacements: { id, groupId, userId: actor.userId, status }, transaction },
      );
      await addEvent(transaction, id, groupId !== row.assignedGroupId ? "ESCALATED" : "ASSIGNED", actor.userId, {
        isPublic: true,
        payload: {
          fromGroupId: row.assignedGroupId,
          toGroupId: groupId,
          fromAssigneeUserId: row.assigneeUserId,
          toAssigneeUserId: actor.userId,
        },
      });
      await markFirstResponse(row, transaction);
      Object.assign(row, { assignedGroupId: groupId, assigneeUserId: actor.userId, status });
    }
    if (row.status === "ASSIGNED") await applyTransition(row, { status: "IN_PROGRESS" }, actor, transaction, "agent");
    return { row, changed };
  });
  if (outcome.changed) pushTo([outcome.row.requesterUserId], "ticket-updated", recordOf(outcome.row));
  return getTicketDetail(id, { audience: "agent" });
}

export interface StatusInput {
  status: TicketStatus;
  onHoldReason?: OnHoldReason;
  resolutionCode?: ResolutionCode;
  resolutionNotes?: string;
  comment?: string;
}

export async function changeStatus(id: number, input: StatusInput, actor: TicketActor): Promise<TicketDetail> {
  const outcome = await postgres.transaction(async (transaction) => {
    const row = await lockWorkableTicket(id, actor, transaction);
    if (!canAgentTransition(row.status, input.status)) {
      throw new ConflictError(`No se puede pasar de ${row.status} a ${input.status}`);
    }
    await applyTransition(row, input, actor, transaction, "agent");
    return row;
  });
  afterTransition(outcome, input);
  return getTicketDetail(id, { audience: "agent" });
}

// Aplica la transicion ya validada: fechas, SLA, evento. Compartido por el
// agente, el solicitante (reabrir/confirmar/anular) y el barrido de auto-cierre.
async function applyTransition(
  row: TicketRow,
  input: StatusInput,
  actor: TicketActor | null,
  transaction: Transaction,
  origin: "agent" | "requester" | "system",
): Promise<void> {
  const actorId = actor?.userId ?? null;
  const sets: string[] = ["status = :status", "updated_at = now()"];
  const replacements: Record<string, unknown> = { id: row.id, status: input.status };
  const payload: Record<string, unknown> = { from: row.status, to: input.status, origin };

  // Salir de ON_HOLD: los minutos habiles en pausa corren el vencimiento.
  if (row.status === "ON_HOLD" && input.status !== "ON_HOLD" && row.onHoldSince && row.slaStartAt) {
    const { calendar } = await loadBusinessCalendar(row.calendarId, transaction);
    const paused = businessMinutesBetween(new Date(row.onHoldSince), new Date(), calendar);
    const totalPaused = row.slaPausedMinutes + paused;
    const dates = await computeSlaDates(row.type, row.priority, new Date(row.slaStartAt), totalPaused, transaction);
    sets.push(
      "on_hold_reason = NULL",
      "on_hold_since = NULL",
      "sla_paused_minutes = :totalPaused",
      "resolution_due_at = :resolutionDueAt",
      "resolution_warn_at = :resolutionWarnAt",
    );
    Object.assign(replacements, {
      totalPaused,
      resolutionDueAt: dates.resolutionDueAt,
      resolutionWarnAt: dates.resolutionWarnAt,
    });
    row.resolutionDueAt = dates.resolutionDueAt;
    payload.pausedMinutes = paused;
  }

  switch (input.status) {
    case "IN_PROGRESS": {
      if (row.assigneeUserId === null) {
        if (!actorId || row.assignedGroupId === null || !(await isGroupMember(row.assignedGroupId, actorId, transaction))) {
          throw new ConflictError("Asigne el ticket a un agente antes de ponerlo en curso");
        }
        sets.push("assignee_user_id = :actorId");
        replacements.actorId = actorId;
      }
      if (row.status === "RESOLVED") {
        sets.push(
          "reopen_count = reopen_count + 1",
          "resolved_at = NULL",
          "resolved_by = NULL",
          "resolution_code = NULL",
          "resolution_notes = NULL",
          "auto_close_at = NULL",
        );
        payload.reopened = true;
        // Reabrir no devuelve el tiempo: el reloj retoma con el mismo vencimiento.
      }
      break;
    }
    case "ON_HOLD": {
      if (!input.onHoldReason) throw new BadRequestError("Indique el motivo de la espera");
      sets.push("on_hold_reason = :onHoldReason", "on_hold_since = now()");
      replacements.onHoldReason = input.onHoldReason;
      payload.reason = input.onHoldReason;
      break;
    }
    case "RESOLVED": {
      if (!input.resolutionCode || !input.resolutionNotes?.trim()) {
        throw new BadRequestError("Indique el codigo y la descripcion de la resolucion");
      }
      await assertNoAssetInSupport(row.id, transaction);
      const autoCloseAt = await computeAutoClose(row, transaction);
      sets.push(
        "resolution_code = :resolutionCode",
        "resolution_notes = :resolutionNotes",
        "resolved_at = now()",
        "resolved_by = :actorId",
        "auto_close_at = :autoCloseAt",
        "resolution_breached = resolution_breached OR (resolution_due_at IS NOT NULL AND now() > resolution_due_at)",
      );
      Object.assign(replacements, {
        resolutionCode: input.resolutionCode,
        resolutionNotes: input.resolutionNotes.trim(),
        actorId,
        autoCloseAt,
      });
      payload.resolutionCode = input.resolutionCode;
      break;
    }
    case "CLOSED":
    case "CANCELLED": {
      // Un activo en soporte quedaria huerfano: se devuelve antes (run-3, F5).
      await assertNoAssetInSupport(row.id, transaction);
      sets.push("closed_at = now()", "closed_by = :closedBy", "on_hold_reason = NULL", "on_hold_since = NULL");
      replacements.closedBy = actorId;
      break;
    }
    default:
      break;
  }

  await postgres.query(`UPDATE service_tickets SET ${sets.join(", ")} WHERE id = :id`, { replacements, transaction });
  await addEvent(transaction, row.id, "STATUS_CHANGED", actorId, {
    isPublic: true,
    body: input.status === "RESOLVED" ? input.resolutionNotes?.trim() : (input.comment?.trim() ?? null),
    payload,
  });
  if (origin === "agent" && (input.status === "IN_PROGRESS" || input.status === "RESOLVED")) {
    await markFirstResponse(row, transaction);
  }
}

async function computeAutoClose(row: TicketRow, transaction: Transaction): Promise<Date> {
  const { calendar } = await loadBusinessCalendar(row.calendarId, transaction);
  return addBusinessMinutes(new Date(), AUTO_CLOSE_BUSINESS_MINUTES, calendar);
}

function afterTransition(row: TicketRow, input: StatusInput): void {
  const record = recordOf(row);
  pushTo([row.requesterUserId], "ticket-updated", record);
  if (input.status === "RESOLVED") {
    fireAndForget(() =>
      emailRequester(
        row.requesterUserId,
        record,
        "Su ticket fue resuelto",
        `Resolución: ${input.resolutionNotes?.trim() ?? ""}\n\nSi el problema sigue, reabra el ticket; si está conforme, confírmelo. Si no hace nada, se cerrará automáticamente en 3 días hábiles.`,
      ),
    );
  }
  if (input.status === "ON_HOLD" && input.onHoldReason === "AWAITING_USER") {
    fireAndForget(() =>
      emailRequester(row.requesterUserId, record, "Necesitamos información suya", input.comment?.trim() || "El ticket quedó en espera de su respuesta. Agregue un comentario para retomarlo."),
    );
  }
}

export interface ClassificationInput {
  categoryId?: number | null;
  impact?: number;
  urgency?: number;
  isMajor?: boolean;
  title?: string;
}

// Reclasificar: si cambia la prioridad, el SLA se recalcula con la nueva politica.
export async function updateClassification(id: number, input: ClassificationInput, actor: TicketActor): Promise<TicketDetail> {
  const outcome = await postgres.transaction(async (transaction) => {
    const row = await lockWorkableTicket(id, actor, transaction);
    if (FINAL_STATUSES.includes(row.status)) throw new ConflictError(`El ticket ${row.number} esta cerrado`);
    if (input.categoryId !== undefined && input.categoryId !== null) {
      const category = await getCategory(input.categoryId, transaction);
      if (!category?.isActive) throw new BadRequestError("La categoria no existe o esta inactiva");
      if (!category.appliesTo.includes(row.type)) throw new BadRequestError(`La categoria ${category.name} no aplica a este tipo de ticket`);
    }
    const impact = input.impact ?? row.impact;
    const urgency = input.urgency ?? row.urgency;
    const priority = resolvePriority(await loadPriorityMatrix(transaction), impact, urgency);
    const isMajor = (input.isMajor ?? row.isMajor) && priority === "P1";
    await postgres.query(
      `UPDATE service_tickets SET category_id = :categoryId, impact = :impact, urgency = :urgency, priority = :priority,
              is_major = :isMajor, title = :title, updated_at = now() WHERE id = :id`,
      {
        replacements: {
          id,
          categoryId: input.categoryId === undefined ? row.categoryId : input.categoryId,
          impact,
          urgency,
          priority,
          isMajor,
          title: input.title ?? row.title,
        },
        transaction,
      },
    );
    if (priority !== row.priority && row.slaStartAt) {
      const dates = await computeSlaDates(row.type, priority, new Date(row.slaStartAt), row.slaPausedMinutes, transaction);
      await applySlaDates(id, new Date(row.slaStartAt), dates, transaction);
    }
    await addEvent(transaction, id, priority !== row.priority ? "PRIORITY_CHANGED" : "UPDATED", actor.userId, {
      isPublic: priority !== row.priority,
      payload: {
        from: { priority: row.priority, impact: row.impact, urgency: row.urgency, categoryId: row.categoryId, isMajor: row.isMajor },
        to: { priority, impact, urgency, categoryId: input.categoryId === undefined ? row.categoryId : input.categoryId, isMajor },
      },
    });
    return { row, becameMajor: isMajor && !row.isMajor };
  });
  if (outcome.becameMajor) {
    const record = recordOf(outcome.row);
    fireAndForget(() =>
      notifyGroup(outcome.row.assignedGroupId, "ticket-assigned", record, "INCIDENTE MAYOR", "Se declaró un incidente mayor.", { allMembers: true }),
    );
  }
  return getTicketDetail(id, { audience: "agent" });
}

// ---------------------------------------------------------------------------
// Comentarios y adjuntos
// ---------------------------------------------------------------------------
export async function addComment(
  id: number,
  input: { body: string; isPublic: boolean },
  actor: TicketActor,
  audience: "agent" | "requester",
): Promise<TicketDetail> {
  const body = input.body.trim();
  if (!body) throw new BadRequestError("El comentario no puede estar vacio");
  const isPublic = audience === "requester" ? true : input.isPublic;
  const outcome = await postgres.transaction(async (transaction) => {
    const row = audience === "agent" ? await lockWorkableTicket(id, actor, transaction) : await lockTicket(id, transaction);
    if (audience === "requester" && row.requesterUserId !== actor.userId) throw new NotFoundError(`El ticket ${id} no existe`);
    if (FINAL_STATUSES.includes(row.status)) throw new ConflictError(`El ticket ${row.number} esta cerrado: abra uno nuevo`);
    await addEvent(transaction, id, isPublic ? "PUBLIC_COMMENT" : "WORK_NOTE", actor.userId, { isPublic, body });
    let resumed = false;
    // La respuesta del solicitante retoma un ticket que esperaba por el.
    if (audience === "requester" && row.status === "ON_HOLD" && row.onHoldReason === "AWAITING_USER") {
      await applyTransition(row, { status: "IN_PROGRESS" }, null, transaction, "requester");
      resumed = true;
    } else {
      await postgres.query(`UPDATE service_tickets SET updated_at = now() WHERE id = :id`, { replacements: { id }, transaction });
    }
    if (audience === "agent" && isPublic) await markFirstResponse(row, transaction);
    return { row, resumed };
  });

  const record = recordOf(outcome.row);
  if (audience === "requester") {
    const targets = outcome.row.assigneeUserId ? [outcome.row.assigneeUserId] : [];
    if (targets.length > 0) pushTo(targets, "ticket-updated", record);
    else fireAndForget(() => notifyGroup(outcome.row.assignedGroupId, "ticket-updated", record, "Nuevo comentario del solicitante", body));
  } else if (isPublic) {
    pushTo([outcome.row.requesterUserId], "ticket-updated", record);
    fireAndForget(() => emailRequester(outcome.row.requesterUserId, record, "Nueva respuesta en su ticket", body));
  }
  return getTicketDetail(id, audience === "requester" ? { audience, requesterUserId: actor.userId } : { audience });
}

// Antes de recibir el archivo: el ticket existe, es visible para quien sube y no esta cerrado.
export async function assertAttachmentAllowed(id: number, actor: TicketActor, audience: "agent" | "requester"): Promise<void> {
  const row = await findRow(id);
  if (!row || (audience === "requester" && row.requesterUserId !== actor.userId)) throw new NotFoundError(`El ticket ${id} no existe`);
  if (audience === "agent") assertTicketInScope(await resolveTicketScope(actor), row);
  if (FINAL_STATUSES.includes(row.status)) throw new ConflictError(`El ticket ${row.number} esta cerrado`);
}

export async function addAttachment(
  id: number,
  file: Express.Multer.File,
  actor: TicketActor,
  options: { audience: "agent" | "requester"; isPublic: boolean },
): Promise<TicketAttachment> {
  const extension = ATTACHMENT_EXTENSIONS[file.mimetype];
  if (!extension) throw new BadRequestError("Tipo de archivo no permitido");
  const storedName = `adjunto-${randomUUID()}${extension}`;
  const isPublic = options.audience === "requester" ? true : options.isPublic;
  // Solo el nombre visible: sin rutas ni caracteres de control.
  const originalName = path.basename(file.originalname).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) || `adjunto${extension}`;
  let written = false;
  try {
    return await postgres.transaction(async (transaction) => {
      const row = options.audience === "agent" ? await lockWorkableTicket(id, actor, transaction) : await lockTicket(id, transaction);
      if (options.audience === "requester" && row.requesterUserId !== actor.userId) throw new NotFoundError(`El ticket ${id} no existe`);
      if (FINAL_STATUSES.includes(row.status)) throw new ConflictError(`El ticket ${row.number} esta cerrado`);
      const [count] = await postgres.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM service_ticket_attachments WHERE ticket_id = :id`,
        { replacements: { id }, type: QueryTypes.SELECT, transaction },
      );
      if ((count?.total ?? 0) >= MAX_TICKET_ATTACHMENTS) {
        throw new ConflictError(`Un ticket admite hasta ${MAX_TICKET_ATTACHMENTS} adjuntos`);
      }
      const [attachment] = await postgres.query<Omit<TicketAttachment, "uploadedByName">>(
        `INSERT INTO service_ticket_attachments (ticket_id, is_public, original_name, stored_name, mime_type, size_bytes, uploaded_by)
         VALUES (:id, :isPublic, :originalName, :storedName, :mimeType, :sizeBytes, :userId)
         RETURNING id, is_public AS "isPublic", original_name AS "originalName", mime_type AS "mimeType",
                   size_bytes AS "sizeBytes", uploaded_by AS "uploadedBy", created_at AS "createdAt"`,
        {
          replacements: { id, isPublic, originalName, storedName, mimeType: file.mimetype, sizeBytes: file.size, userId: actor.userId },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      await addEvent(transaction, id, "ATTACHMENT_ADDED", actor.userId, {
        isPublic,
        payload: { attachmentId: attachment!.id, originalName },
      });
      saveBuffer(getServiceTicketFolder(id), storedName, file.buffer);
      written = true;
      return { ...attachment!, uploadedByName: null };
    });
  } catch (err) {
    if (written) deleteIfExists(getServiceTicketFolder(id), storedName);
    throw err;
  }
}

export async function getAttachmentFile(
  id: number,
  attachmentId: number,
  options: DetailOptions,
): Promise<{ filePath: string; mimeType: string; downloadName: string }> {
  const [row] = await postgres.query<{
    storedName: string;
    mimeType: string;
    originalName: string;
    isPublic: boolean;
    requesterUserId: number;
    assignedGroupId: number | null;
    status: string;
    approvalGroupId: number | null;
  }>(
    `SELECT a.stored_name AS "storedName", a.mime_type AS "mimeType", a.original_name AS "originalName",
            a.is_public AS "isPublic", t.requester_user_id AS "requesterUserId", t.assigned_group_id AS "assignedGroupId",
            t.status, t.approval_group_id AS "approvalGroupId"
       FROM service_ticket_attachments a JOIN service_tickets t ON t.id = a.ticket_id
      WHERE a.id = :attachmentId AND a.ticket_id = :id`,
    { replacements: { id, attachmentId }, type: QueryTypes.SELECT },
  );
  const hidden =
    (options.audience === "requester" && (!row || row.requesterUserId !== options.requesterUserId || !row.isPublic)) ||
    (options.audience === "agent" &&
      !!row &&
      !!options.scope &&
      !isTicketInScope(options.scope, row) &&
      !(row.isPublic && isPendingApprovalFor(options.scope, row)));
  if (!row || hidden) throw new NotFoundError(`El adjunto ${attachmentId} no existe`);
  const folder = getServiceTicketFolder(id);
  const filePath = path.resolve(folder, path.basename(row.storedName));
  if (!filePath.startsWith(path.resolve(folder) + path.sep) || !fs.existsSync(filePath)) {
    throw new NotFoundError("El adjunto no se encuentra en el almacenamiento");
  }
  return { filePath, mimeType: row.mimeType, downloadName: row.originalName };
}

// ---------------------------------------------------------------------------
// Aprobacion de solicitudes del catalogo
// ---------------------------------------------------------------------------
export async function decideApproval(
  id: number,
  input: { decision: "APPROVED" | "REJECTED"; comment?: string },
  actor: TicketActor,
): Promise<TicketDetail> {
  const outcome = await postgres.transaction(async (transaction) => {
    const row = await lockTicket(id, transaction);
    if (row.status !== "PENDING_APPROVAL") throw new ConflictError(`El ticket ${row.number} no esta pendiente de aprobacion`);
    if (!row.approvalGroupId) throw new ConflictError("El servicio pedido no requiere aprobacion");
    if (!(await isGroupMember(row.approvalGroupId, actor.userId, transaction))) {
      throw new ForbiddenError("Solo un miembro del grupo aprobador puede decidir esta solicitud");
    }
    // Tampoco quien la registro a nombre de otro (run-3, F2).
    if (row.requesterUserId === actor.userId || row.openedBy === actor.userId) {
      throw new ForbiddenError("No puede aprobar una solicitud que usted pidio o registro");
    }
    if (input.decision === "REJECTED" && !input.comment?.trim()) throw new BadRequestError("Explique el motivo del rechazo");

    await postgres.query(
      `INSERT INTO service_ticket_approvals (ticket_id, approver_user_id, decision, comment) VALUES (:id, :userId, :decision, :comment)`,
      { replacements: { id, userId: actor.userId, decision: input.decision, comment: input.comment?.trim() ?? null }, transaction },
    );
    await addEvent(transaction, id, "APPROVAL_DECIDED", actor.userId, {
      isPublic: true,
      body: input.comment?.trim() ?? null,
      payload: { decision: input.decision },
    });
    if (input.decision === "APPROVED") {
      await postgres.query(`UPDATE service_tickets SET status = 'NEW', updated_at = now() WHERE id = :id`, {
        replacements: { id },
        transaction,
      });
      await startSla(row, transaction);
    } else {
      await applyTransition(row, { status: "CANCELLED", comment: input.comment }, actor, transaction, "agent");
    }
    return row;
  });

  const record = recordOf(outcome);
  pushTo([outcome.requesterUserId], "ticket-updated", record);
  fireAndForget(async () => {
    await emailRequester(
      outcome.requesterUserId,
      record,
      input.decision === "APPROVED" ? "Su solicitud fue aprobada" : "Su solicitud fue rechazada",
      input.decision === "APPROVED" ? "La solicitud pasó a la cola de atención." : `Motivo: ${input.comment?.trim() ?? ""}`,
    );
    if (input.decision === "APPROVED") {
      await notifyGroup(outcome.assignedGroupId, "ticket-assigned", record, "Nueva solicitud aprobada en la cola", "Se aprobó una solicitud y quedó en la cola del grupo.");
    }
  });
  // El aprobador que no es de la cola ve solo lo publico, como el solicitante (run-3 final, L2).
  if (isTicketInScope(await resolveTicketScope(actor), outcome)) return getTicketDetail(id, { audience: "agent" });
  return getTicketDetail(id, { audience: "requester", requesterUserId: outcome.requesterUserId });
}

// Solicitudes que el usuario puede aprobar (miembro del grupo aprobador, no propias).
export async function listPendingApprovals(actor: TicketActor, params: PaginationParams): Promise<{ items: TicketSummary[]; total: number }> {
  const where = `WHERE t.status = 'PENDING_APPROVAL' AND t.requester_user_id <> :userId AND t.opened_by <> :userId
                   AND EXISTS (SELECT 1 FROM support_group_members m WHERE m.group_id = t.approval_group_id AND m.user_id = :userId)`;
  const [countRow] = await postgres.query<{ total: number }>(`SELECT COUNT(*)::int AS total ${LIST_FROM} ${where}`, {
    replacements: { userId: actor.userId },
    type: QueryTypes.SELECT,
  });
  const rows = await postgres.query<ListRow>(
    `SELECT ${ROW_COLUMNS}, c.name AS "categoryName", ci.name AS "catalogItemName", g.name AS "assignedGroupName"
       ${LIST_FROM} ${where} ORDER BY t.id LIMIT :limit OFFSET :offset`,
    { replacements: { userId: actor.userId, limit: params.limit, offset: getOffset(params) }, type: QueryTypes.SELECT },
  );
  return { items: await withNames(rows), total: countRow?.total ?? 0 };
}

// ---------------------------------------------------------------------------
// Acciones del solicitante
// ---------------------------------------------------------------------------
export async function requesterAction(
  id: number,
  action: "cancel" | "reopen" | "confirm",
  input: { comment?: string; csatScore?: number; csatComment?: string },
  actor: TicketActor,
): Promise<TicketDetail> {
  const outcome = await postgres.transaction(async (transaction) => {
    const row = await lockTicket(id, transaction);
    if (row.requesterUserId !== actor.userId) throw new NotFoundError(`El ticket ${id} no existe`);
    switch (action) {
      case "cancel":
        if (!canRequesterCancel(row.status)) throw new ConflictError("El ticket ya se esta atendiendo: pida la anulacion en un comentario");
        await applyTransition(row, { status: "CANCELLED", comment: input.comment ?? "Anulado por el solicitante" }, actor, transaction, "requester");
        break;
      case "reopen":
        if (row.status !== "RESOLVED") throw new ConflictError("Solo se reabre un ticket resuelto");
        if (!input.comment?.trim()) throw new BadRequestError("Cuente por que el problema sigue");
        await applyTransition(row, { status: "IN_PROGRESS", comment: input.comment }, actor, transaction, "requester");
        break;
      case "confirm":
        if (row.status !== "RESOLVED") throw new ConflictError("Solo se confirma un ticket resuelto");
        await applyTransition(row, { status: "CLOSED", comment: "Confirmado por el solicitante" }, actor, transaction, "requester");
        if (input.csatScore) {
          await postgres.query(
            `UPDATE service_tickets SET csat_score = :score, csat_comment = :comment WHERE id = :id`,
            { replacements: { id, score: input.csatScore, comment: input.csatComment?.trim() || null }, transaction },
          );
          await addEvent(transaction, id, "CSAT", actor.userId, { isPublic: true, body: input.csatComment?.trim() || null, payload: { score: input.csatScore } });
        }
        break;
    }
    return row;
  });

  const record = recordOf(outcome);
  const targets = outcome.assigneeUserId ? [outcome.assigneeUserId] : [];
  pushTo(targets, "ticket-updated", record);
  if (action === "reopen") {
    fireAndForget(() => emailUsersAbout(targets, record, "El solicitante reabrió el ticket", input.comment?.trim() ?? ""));
  }
  return getTicketDetail(id, { audience: "requester", requesterUserId: actor.userId });
}

// Cierre automatico de un RESUELTO sin respuesta (lo llama el barrido de SLA).
export async function autoCloseTicket(id: number): Promise<boolean> {
  return postgres.transaction(async (transaction) => {
    const row = await lockTicket(id, transaction);
    if (row.status !== "RESOLVED" || !row.autoCloseAt || new Date(row.autoCloseAt).getTime() > Date.now()) return false;
    await applyTransition(row, { status: "CLOSED", comment: "Cierre automático: sin respuesta del solicitante" }, null, transaction, "system");
    return true;
  });
}

// ---------------------------------------------------------------------------
// Resumen para la campana de notificaciones
// ---------------------------------------------------------------------------
export async function getServiceDeskPendingCounts(userId: number): Promise<{ assignedOpenTickets: number; pendingTicketApprovals: number }> {
  const [row] = await postgres.query<{ assigned: number; approvals: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM service_tickets WHERE assignee_user_id = :userId AND status IN ('ASSIGNED','IN_PROGRESS')) AS assigned,
       (SELECT COUNT(*)::int FROM service_tickets t
          WHERE t.status = 'PENDING_APPROVAL' AND t.requester_user_id <> :userId AND t.opened_by <> :userId
            AND EXISTS (SELECT 1 FROM support_group_members m WHERE m.group_id = t.approval_group_id AND m.user_id = :userId)) AS approvals`,
    { replacements: { userId }, type: QueryTypes.SELECT },
  );
  return { assignedOpenTickets: row?.assigned ?? 0, pendingTicketApprovals: row?.approvals ?? 0 };
}
