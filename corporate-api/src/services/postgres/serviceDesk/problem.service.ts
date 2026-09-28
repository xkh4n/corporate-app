import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { BadRequestError, ConflictError, NotFoundError } from "../../../library/errors";
import type { PaginationParams } from "../../../library/pagination";
import { getOffset } from "../../../library/pagination";
import { resolvePriority, type Priority } from "../../../library/serviceDesk/ticketRules";
import { getUserDirectory } from "../../mssql/user.service";
import { nextServiceDeskNumber } from "./numbering";
import { fireAndForget, emailUsersAbout, pushTo } from "./notifications";
import { getCategory, isGroupMember, loadPriorityMatrix } from "./settings.service";
import * as ticketService from "./ticket.service";
import { filterTicketsInScope, resolveTicketScope } from "./ticketScope";
import { createArticle } from "./kb.service";

// Gestion de problemas (plan 009, fase 9C, ITIL v4): la causa raiz detras de
// uno o varios incidentes. Error conocido = causa identificada + solucion
// temporal (workaround) mientras llega la definitiva.

export const PROBLEM_STATUSES = ["NEW", "UNDER_INVESTIGATION", "KNOWN_ERROR", "RESOLVED", "CLOSED", "CANCELLED"] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

const TRANSITIONS: Record<ProblemStatus, ProblemStatus[]> = {
  NEW: ["UNDER_INVESTIGATION", "CANCELLED"],
  UNDER_INVESTIGATION: ["KNOWN_ERROR", "RESOLVED", "CANCELLED"],
  KNOWN_ERROR: ["UNDER_INVESTIGATION", "RESOLVED"],
  RESOLVED: ["CLOSED", "UNDER_INVESTIGATION"],
  CLOSED: [],
  CANCELLED: [],
};

export function canProblemTransition(from: ProblemStatus, to: ProblemStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface ProblemSummary {
  id: number;
  number: string;
  status: ProblemStatus;
  title: string;
  priority: Priority;
  categoryName: string | null;
  assignedGroupId: number | null;
  assignedGroupName: string | null;
  assigneeUserId: number | null;
  assigneeName: string | null;
  incidentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProblemDetail extends ProblemSummary {
  description: string;
  categoryId: number | null;
  impact: number;
  urgency: number;
  rootCause: string | null;
  workaround: string | null;
  permanentFix: string | null;
  kbArticleId: number | null;
  createdBy: number;
  knownErrorAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  allowedTransitions: ProblemStatus[];
  incidents: ticketService.TicketSummary[];
  assets: { assetId: number; tag: string; statusCode: string }[];
  changes: { id: number; number: string; title: string; status: string }[];
  events: { id: number; eventType: string; actorName: string | null; body: string | null; payload: Record<string, unknown>; createdAt: Date }[];
}

const SUMMARY_COLUMNS = `
  p.id, p.number, p.status, p.title, p.priority, c.name AS "categoryName", p.assigned_group_id AS "assignedGroupId",
  g.name AS "assignedGroupName", p.assignee_user_id AS "assigneeUserId",
  (SELECT COUNT(*)::int FROM service_tickets t WHERE t.problem_id = p.id) AS "incidentCount",
  p.created_at AS "createdAt", p.updated_at AS "updatedAt"
`;
const FROM = `FROM service_problems p LEFT JOIN service_categories c ON c.id = p.category_id LEFT JOIN support_groups g ON g.id = p.assigned_group_id`;

async function withAssignees<T extends { assigneeUserId: number | null }>(rows: T[]): Promise<(T & { assigneeName: string | null })[]> {
  const directory = await getUserDirectory(rows.map((row) => row.assigneeUserId ?? 0));
  return rows.map((row) => ({
    ...row,
    assigneeName: row.assigneeUserId ? (directory.get(row.assigneeUserId)?.fullName ?? `Usuario ${row.assigneeUserId}`) : null,
  }));
}

async function addEvent(
  transaction: Transaction,
  problemId: number,
  eventType: string,
  actorUserId: number | null,
  options: { body?: string | null; payload?: Record<string, unknown> } = {},
): Promise<void> {
  await postgres.query(
    `INSERT INTO service_problem_events (problem_id, event_type, actor_user_id, body, payload)
     VALUES (:problemId, :eventType, :actorUserId, :body, CAST(:payload AS JSONB))`,
    {
      replacements: { problemId, eventType, actorUserId, body: options.body ?? null, payload: JSON.stringify(options.payload ?? {}) },
      transaction,
    },
  );
}

export async function listProblems(
  params: PaginationParams,
  filters: { statuses?: ProblemStatus[]; includeClosed?: boolean },
): Promise<{ items: ProblemSummary[]; total: number }> {
  const conditions: string[] = [];
  const replacements: Record<string, unknown> = {};
  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push("p.status IN (:statuses)");
    replacements.statuses = filters.statuses;
  } else if (!filters.includeClosed) {
    conditions.push("p.status NOT IN ('CLOSED','CANCELLED')");
  }
  if (params.search) {
    conditions.push("(p.number ILIKE :search OR p.title ILIKE :search)");
    replacements.search = `%${params.search}%`;
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const [countRow] = await postgres.query<{ total: number }>(`SELECT COUNT(*)::int AS total ${FROM} ${where}`, {
    replacements,
    type: QueryTypes.SELECT,
  });
  const rows = await postgres.query<Omit<ProblemSummary, "assigneeName">>(
    `SELECT ${SUMMARY_COLUMNS} ${FROM} ${where} ORDER BY p.priority, p.id DESC LIMIT :limit OFFSET :offset`,
    { replacements: { ...replacements, limit: params.limit, offset: getOffset(params) }, type: QueryTypes.SELECT },
  );
  return { items: await withAssignees(rows), total: countRow?.total ?? 0 };
}

export async function getProblemDetail(id: number): Promise<ProblemDetail> {
  const [row] = await postgres.query<Omit<ProblemDetail, "assigneeName" | "allowedTransitions" | "incidents" | "assets" | "changes" | "events">>(
    `SELECT ${SUMMARY_COLUMNS}, p.description, p.category_id AS "categoryId", p.impact, p.urgency, p.root_cause AS "rootCause",
            p.workaround, p.permanent_fix AS "permanentFix", p.kb_article_id AS "kbArticleId", p.created_by AS "createdBy",
            p.known_error_at AS "knownErrorAt", p.resolved_at AS "resolvedAt", p.closed_at AS "closedAt"
       ${FROM} WHERE p.id = :id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  if (!row) throw new NotFoundError(`El problema ${id} no existe`);
  const [withName] = await withAssignees([row]);
  const { items: incidents } = await ticketService.listTickets(
    { page: 1, limit: 200, sortBy: "id", sortOrder: "desc" },
    { problemId: id, includeClosed: true },
    { userId: 0 },
  );
  const assets = await postgres.query<{ assetId: number; tag: string; statusCode: string }>(
    `SELECT a.id AS "assetId", a.tag, s.code AS "statusCode" FROM service_problem_assets l
       JOIN assets a ON a.id = l.asset_id JOIN asset_statuses s ON s.id = a.status_id WHERE l.problem_id = :id ORDER BY a.tag`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  const changes = await postgres.query<{ id: number; number: string; title: string; status: string }>(
    `SELECT id, number, title, status FROM service_changes WHERE problem_id = :id ORDER BY id DESC`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  const events = await postgres.query<{ id: number; eventType: string; actorUserId: number | null; body: string | null; payload: Record<string, unknown>; createdAt: Date }>(
    `SELECT id::int AS id, event_type AS "eventType", actor_user_id AS "actorUserId", body, payload, created_at AS "createdAt"
       FROM service_problem_events WHERE problem_id = :id ORDER BY id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  const directory = await getUserDirectory(events.map((event) => event.actorUserId ?? 0));
  return {
    ...withName!,
    allowedTransitions: TRANSITIONS[row.status],
    incidents,
    assets,
    changes,
    events: events.map(({ actorUserId, ...event }) => ({
      ...event,
      actorName: actorUserId ? (directory.get(actorUserId)?.fullName ?? `Usuario ${actorUserId}`) : null,
    })),
  };
}

export interface ProblemInput {
  title: string;
  description: string;
  categoryId?: number | null;
  impact: number;
  urgency: number;
  assignedGroupId?: number | null;
  assigneeUserId?: number | null;
  rootCause?: string | null;
  workaround?: string | null;
  permanentFix?: string | null;
}

async function assertAssignment(groupId: number | null | undefined, assigneeUserId: number | null | undefined, transaction: Transaction): Promise<void> {
  if (assigneeUserId === null || assigneeUserId === undefined) return;
  if (!groupId) throw new BadRequestError("Para asignar un responsable elija tambien su grupo");
  if (!(await isGroupMember(groupId, assigneeUserId, transaction))) throw new ConflictError("El responsable no es miembro del grupo elegido");
}

async function assertCategory(categoryId: number | null | undefined, transaction: Transaction): Promise<void> {
  if (!categoryId) return;
  const category = await getCategory(categoryId, transaction);
  if (!category?.isActive || !category.appliesTo.includes("PROBLEM")) throw new BadRequestError("La categoria no aplica a problemas");
}

export async function createProblem(
  input: ProblemInput & { incidentIds?: number[]; assetIds?: number[] },
  userId: number,
): Promise<ProblemDetail> {
  const created = await postgres.transaction(async (transaction) => {
    await assertCategory(input.categoryId, transaction);
    await assertAssignment(input.assignedGroupId, input.assigneeUserId, transaction);
    const priority = resolvePriority(await loadPriorityMatrix(transaction), input.impact, input.urgency);
    const number = await nextServiceDeskNumber("PRB", transaction, input.assignedGroupId ?? null);
    const [row] = await postgres.query<{ id: number }>(
      `INSERT INTO service_problems (number, status, title, description, category_id, impact, urgency, priority,
                                     assigned_group_id, assignee_user_id, root_cause, workaround, created_by)
       VALUES (:number, 'NEW', :title, :description, :categoryId, :impact, :urgency, :priority, :groupId, :assigneeUserId,
               :rootCause, :workaround, :userId) RETURNING id`,
      {
        replacements: {
          number,
          title: input.title,
          description: input.description,
          categoryId: input.categoryId ?? null,
          impact: input.impact,
          urgency: input.urgency,
          priority,
          groupId: input.assignedGroupId ?? null,
          assigneeUserId: input.assigneeUserId ?? null,
          rootCause: input.rootCause ?? null,
          workaround: input.workaround ?? null,
          userId,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    const id = row!.id;
    await addEvent(transaction, id, "CREATED", userId, { payload: { priority } });
    if (input.incidentIds?.length) await linkIncidentsInTransaction(id, number, input.incidentIds, userId, transaction);
    if (input.assetIds?.length) await linkAssetsInTransaction(id, input.assetIds, userId, transaction);
    return { id, number };
  });
  if (input.assigneeUserId && input.assigneeUserId !== userId) {
    pushTo([input.assigneeUserId], "problem-assigned", { id: created.id, number: created.number, title: input.title });
  }
  return getProblemDetail(created.id);
}

async function lockProblem(id: number, transaction: Transaction) {
  const [row] = await postgres.query<{
    number: string;
    title: string;
    status: ProblemStatus;
    assigneeUserId: number | null;
    assignedGroupId: number | null;
    rootCause: string | null;
    workaround: string | null;
    permanentFix: string | null;
  }>(
    `SELECT number, title, status, assignee_user_id AS "assigneeUserId", assigned_group_id AS "assignedGroupId",
            root_cause AS "rootCause", workaround, permanent_fix AS "permanentFix"
       FROM service_problems WHERE id = :id FOR UPDATE`,
    { replacements: { id }, type: QueryTypes.SELECT, transaction },
  );
  if (!row) throw new NotFoundError(`El problema ${id} no existe`);
  return row;
}

export async function updateProblem(id: number, input: ProblemInput, userId: number): Promise<ProblemDetail> {
  const outcome = await postgres.transaction(async (transaction) => {
    const row = await lockProblem(id, transaction);
    if (row.status === "CLOSED" || row.status === "CANCELLED") throw new ConflictError(`El problema ${row.number} esta cerrado`);
    await assertCategory(input.categoryId, transaction);
    await assertAssignment(input.assignedGroupId, input.assigneeUserId, transaction);
    if (row.status === "KNOWN_ERROR" && !input.workaround?.trim()) throw new BadRequestError("Un error conocido debe mantener su solucion temporal");
    const priority = resolvePriority(await loadPriorityMatrix(transaction), input.impact, input.urgency);
    await postgres.query(
      `UPDATE service_problems SET title = :title, description = :description, category_id = :categoryId, impact = :impact,
              urgency = :urgency, priority = :priority, assigned_group_id = :groupId, assignee_user_id = :assigneeUserId,
              root_cause = :rootCause, workaround = :workaround, permanent_fix = :permanentFix, updated_at = now()
        WHERE id = :id`,
      {
        replacements: {
          id,
          title: input.title,
          description: input.description,
          categoryId: input.categoryId ?? null,
          impact: input.impact,
          urgency: input.urgency,
          priority,
          groupId: input.assignedGroupId ?? null,
          assigneeUserId: input.assigneeUserId ?? null,
          rootCause: input.rootCause?.trim() || null,
          workaround: input.workaround?.trim() || null,
          permanentFix: input.permanentFix?.trim() || null,
        },
        transaction,
      },
    );
    await addEvent(transaction, id, "UPDATED", userId, {
      payload: {
        rootCauseChanged: (input.rootCause?.trim() || null) !== row.rootCause,
        workaroundChanged: (input.workaround?.trim() || null) !== row.workaround,
      },
    });
    return row;
  });
  if (input.assigneeUserId && input.assigneeUserId !== outcome.assigneeUserId && input.assigneeUserId !== userId) {
    pushTo([input.assigneeUserId], "problem-assigned", { id, number: outcome.number, title: input.title });
  }
  return getProblemDetail(id);
}

export interface ProblemStatusResult {
  problem: ProblemDetail;
  resolvedIncidents: string[];
  skippedIncidents: { number: string; reason: string }[];
}

export async function changeProblemStatus(
  id: number,
  input: { status: ProblemStatus; comment?: string; resolveLinkedIncidents?: boolean },
  userId: number,
  // Quien resuelve los incidentes en bloque: se aplica su alcance por grupos.
  incidentActor: { userId: number; isAdmin?: boolean } = { userId },
): Promise<ProblemStatusResult> {
  const outcome = await postgres.transaction(async (transaction) => {
    const row = await lockProblem(id, transaction);
    if (!canProblemTransition(row.status, input.status)) throw new ConflictError(`No se puede pasar de ${row.status} a ${input.status}`);
    const sets = ["status = :status", "updated_at = now()"];
    if (input.status === "KNOWN_ERROR") {
      if (!row.workaround) throw new BadRequestError("Registre la solucion temporal (workaround) antes de declarar el error conocido");
      if (!row.rootCause) throw new BadRequestError("Registre la causa raiz antes de declarar el error conocido");
      sets.push("known_error_at = COALESCE(known_error_at, now())");
    }
    if (input.status === "RESOLVED") {
      if (!row.rootCause || !row.permanentFix) throw new BadRequestError("Registre la causa raiz y la solucion definitiva antes de resolver");
      sets.push("resolved_at = now()", "resolved_by = :userId");
    }
    if (input.status === "UNDER_INVESTIGATION") sets.push("resolved_at = NULL", "resolved_by = NULL");
    if (input.status === "CLOSED" || input.status === "CANCELLED") sets.push("closed_at = now()", "closed_by = :userId");
    await postgres.query(`UPDATE service_problems SET ${sets.join(", ")} WHERE id = :id`, {
      replacements: { id, status: input.status, userId },
      transaction,
    });
    await addEvent(transaction, id, "STATUS_CHANGED", userId, { body: input.comment ?? null, payload: { from: row.status, to: input.status } });

    // El error conocido se publica como nota interna en los incidentes abiertos vinculados.
    if (input.status === "KNOWN_ERROR") {
      const open = await postgres.query<{ id: number }>(
        `SELECT id FROM service_tickets WHERE problem_id = :id AND status NOT IN ('RESOLVED','CLOSED','CANCELLED')`,
        { replacements: { id }, type: QueryTypes.SELECT, transaction },
      );
      for (const ticket of open) {
        await ticketService.addTicketEvent(transaction, ticket.id, "WORK_NOTE", userId, {
          body: `Error conocido ${row.number}. Solución temporal: ${row.workaround}`,
          payload: { problemId: id },
        });
      }
    }
    return row;
  });

  const resolvedIncidents: string[] = [];
  const skippedIncidents: { number: string; reason: string }[] = [];
  if (input.status === "RESOLVED" && input.resolveLinkedIncidents) {
    const linked = await postgres.query<{ id: number; number: string; status: string; assignedGroupId: number | null }>(
      `SELECT id, number, status, assigned_group_id AS "assignedGroupId"
         FROM service_tickets WHERE problem_id = :id AND status NOT IN ('RESOLVED','CLOSED','CANCELLED') ORDER BY id`,
      { replacements: { id }, type: QueryTypes.SELECT },
    );
    // Solo los incidentes de los grupos de quien resuelve; los demas ni se nombran.
    const open = filterTicketsInScope(linked, await resolveTicketScope(incidentActor));
    if (open.length < linked.length) {
      skippedIncidents.push({ number: `${linked.length - open.length} incidente(s)`, reason: "De otros grupos de soporte" });
    }
    // Cada incidente en su propia transaccion: uno que no se pueda resolver (sin agente, activo en soporte) no frena al resto.
    for (const ticket of open) {
      try {
        if (ticket.status === "NEW" || ticket.status === "PENDING_APPROVAL") {
          skippedIncidents.push({ number: ticket.number, reason: "Sin agente asignado" });
          continue;
        }
        await ticketService.changeStatus(
          ticket.id,
          {
            status: "RESOLVED",
            resolutionCode: "FIXED",
            resolutionNotes: `Resuelto por el problema ${outcome.number}: ${outcome.permanentFix ?? ""}`.trim(),
          },
          incidentActor,
        );
        resolvedIncidents.push(ticket.number);
      } catch (err) {
        skippedIncidents.push({ number: ticket.number, reason: err instanceof Error ? err.message : "Error" });
      }
    }
  }
  if (input.status === "KNOWN_ERROR" && outcome.assigneeUserId) {
    fireAndForget(() =>
      emailUsersAbout([outcome.assigneeUserId], { id, number: outcome.number, title: outcome.title }, "Problema declarado error conocido", outcome.workaround ?? ""),
    );
  }
  return { problem: await getProblemDetail(id), resolvedIncidents, skippedIncidents };
}

async function linkIncidentsInTransaction(
  problemId: number,
  problemNumber: string,
  ticketIds: number[],
  userId: number,
  transaction: Transaction,
): Promise<void> {
  const ids = [...new Set(ticketIds)];
  const tickets = await postgres.query<{ id: number; number: string; type: string; problemId: number | null }>(
    `SELECT id, number, type, problem_id AS "problemId" FROM service_tickets WHERE id IN (:ids) FOR UPDATE`,
    { replacements: { ids }, type: QueryTypes.SELECT, transaction },
  );
  if (tickets.length !== ids.length) throw new BadRequestError("Algunos tickets no existen");
  const invalid = tickets.filter((ticket) => ticket.type !== "INCIDENT");
  if (invalid.length > 0) throw new BadRequestError(`Solo se vinculan incidentes: ${invalid.map((ticket) => ticket.number).join(", ")}`);
  const taken = tickets.filter((ticket) => ticket.problemId !== null && ticket.problemId !== problemId);
  if (taken.length > 0) throw new ConflictError(`Ya pertenecen a otro problema: ${taken.map((ticket) => ticket.number).join(", ")}`);
  for (const ticket of tickets) {
    if (ticket.problemId === problemId) continue;
    await postgres.query(`UPDATE service_tickets SET problem_id = :problemId, updated_at = now() WHERE id = :id`, {
      replacements: { problemId, id: ticket.id },
      transaction,
    });
    await ticketService.addTicketEvent(transaction, ticket.id, "LINKED_PROBLEM", userId, { payload: { problemId, number: problemNumber } });
    await addEvent(transaction, problemId, "INCIDENT_LINKED", userId, { payload: { ticketId: ticket.id, number: ticket.number } });
  }
}

async function linkAssetsInTransaction(problemId: number, assetIds: number[], userId: number, transaction: Transaction): Promise<void> {
  const ids = [...new Set(assetIds)];
  const assets = await postgres.query<{ id: number }>(`SELECT id FROM assets WHERE id IN (:ids)`, {
    replacements: { ids },
    type: QueryTypes.SELECT,
    transaction,
  });
  if (assets.length !== ids.length) throw new BadRequestError("Algunos activos no existen");
  for (const assetId of ids) {
    await postgres.query(
      `INSERT INTO service_problem_assets (problem_id, asset_id, linked_by) VALUES (:problemId, :assetId, :userId) ON CONFLICT DO NOTHING`,
      { replacements: { problemId, assetId, userId }, transaction },
    );
  }
  await addEvent(transaction, problemId, "ASSETS_LINKED", userId, { payload: { assetIds: ids } });
}

async function lockOpenProblem(id: number, transaction: Transaction) {
  const row = await lockProblem(id, transaction);
  if (row.status === "CLOSED" || row.status === "CANCELLED") throw new ConflictError(`El problema ${row.number} esta cerrado`);
  return row;
}

export async function linkIncidents(id: number, ticketIds: number[], userId: number): Promise<ProblemDetail> {
  await postgres.transaction(async (transaction) => {
    const row = await lockOpenProblem(id, transaction);
    await linkIncidentsInTransaction(id, row.number, ticketIds, userId, transaction);
  });
  return getProblemDetail(id);
}

export async function unlinkIncident(id: number, ticketId: number, userId: number): Promise<ProblemDetail> {
  await postgres.transaction(async (transaction) => {
    await lockOpenProblem(id, transaction);
    const [ticket] = await postgres.query<{ number: string }>(
      `UPDATE service_tickets SET problem_id = NULL, updated_at = now() WHERE id = :ticketId AND problem_id = :id RETURNING number`,
      { replacements: { id, ticketId }, type: QueryTypes.SELECT, transaction },
    );
    if (!ticket) throw new NotFoundError("El incidente no esta vinculado a este problema");
    await ticketService.addTicketEvent(transaction, ticketId, "UNLINKED_PROBLEM", userId, { payload: { problemId: id } });
    await addEvent(transaction, id, "INCIDENT_UNLINKED", userId, { payload: { ticketId, number: ticket.number } });
  });
  return getProblemDetail(id);
}

export async function linkAssets(id: number, assetIds: number[], userId: number): Promise<ProblemDetail> {
  await postgres.transaction(async (transaction) => {
    await lockOpenProblem(id, transaction);
    await linkAssetsInTransaction(id, assetIds, userId, transaction);
  });
  return getProblemDetail(id);
}

export async function unlinkAsset(id: number, assetId: number, userId: number): Promise<ProblemDetail> {
  await postgres.transaction(async (transaction) => {
    await lockOpenProblem(id, transaction);
    const [row] = await postgres.query(
      `DELETE FROM service_problem_assets WHERE problem_id = :id AND asset_id = :assetId RETURNING asset_id`,
      { replacements: { id, assetId }, type: QueryTypes.SELECT, transaction },
    );
    if (!row) throw new NotFoundError("El activo no esta vinculado a este problema");
    await addEvent(transaction, id, "ASSET_UNLINKED", userId, { payload: { assetId } });
  });
  return getProblemDetail(id);
}

// "Publicar como KB": borrador de articulo (interno) con la causa y la
// solucion temporal del error conocido; queda enlazado al problema.
export async function createKbDraftFromProblem(id: number, userId: number): Promise<{ articleId: number }> {
  const [row] = await postgres.query<{
    number: string;
    title: string;
    description: string;
    categoryId: number | null;
    rootCause: string | null;
    workaround: string | null;
    permanentFix: string | null;
    kbArticleId: number | null;
  }>(
    `SELECT number, title, description, category_id AS "categoryId", root_cause AS "rootCause", workaround,
            permanent_fix AS "permanentFix", kb_article_id AS "kbArticleId"
       FROM service_problems WHERE id = :id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  if (!row) throw new NotFoundError(`El problema ${id} no existe`);
  if (row.kbArticleId) throw new ConflictError("El problema ya tiene un articulo de conocimiento");
  if (!row.workaround && !row.permanentFix) throw new BadRequestError("Registre la solucion temporal o la definitiva antes de documentarla");
  const body = [
    `Síntoma\n${row.description}`,
    row.rootCause ? `Causa\n${row.rootCause}` : null,
    row.workaround ? `Solución temporal\n${row.workaround}` : null,
    row.permanentFix ? `Solución definitiva\n${row.permanentFix}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const article = await createArticle(
    { title: row.title, body, categoryId: row.categoryId, audience: "INTERNAL", sourceProblemId: id },
    userId,
  );
  await postgres.transaction(async (transaction) => {
    await postgres.query(`UPDATE service_problems SET kb_article_id = :articleId, updated_at = now() WHERE id = :id`, {
      replacements: { id, articleId: article.id },
      transaction,
    });
    await addEvent(transaction, id, "KB_DRAFTED", userId, { payload: { articleId: article.id, number: article.number } });
  });
  return { articleId: article.id };
}
