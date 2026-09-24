import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { BadRequestError, ForbiddenError } from "../library/errors";
import { buildPaginationMeta, parsePaginationParams } from "../library/pagination";
import { sendList, sendOk } from "../library/response";
import { roleGrantsPermission } from "../services/postgres/permission.service";
import * as changeService from "../services/postgres/serviceDesk/change.service";
import * as kbService from "../services/postgres/serviceDesk/kb.service";
import * as problemService from "../services/postgres/serviceDesk/problem.service";
import * as reportService from "../services/postgres/serviceDesk/report.service";
import { assertTicketsInScope, filterTicketsInScope, isTicketInScope, resolveTicketScope } from "../services/postgres/serviceDesk/ticketScope";
import { actorCan, actorOf, ID, LEVEL, parseId, queryString, requireUserId, TEXT } from "./serviceDesk.shared";
import { auditChange } from "./serviceDeskSettings.controller";

// Service Desk (plan 009): problemas (9C), cambios (9D), conocimiento e indicadores (9E).

const LONG_TEXT = z.string().trim().max(8000);
const ISO_DATETIME = z.string().datetime({ offset: true });

// ---- Problemas ------------------------------------------------------------
const problemFields = {
  title: TEXT(160),
  description: TEXT(8000),
  categoryId: ID.nullable().optional(),
  impact: LEVEL,
  urgency: LEVEL,
  assignedGroupId: ID.nullable().optional(),
  assigneeUserId: ID.nullable().optional(),
  rootCause: LONG_TEXT.nullable().optional(),
  workaround: LONG_TEXT.nullable().optional(),
  permanentFix: LONG_TEXT.nullable().optional(),
};
export const createProblemSchema = z
  .object({ ...problemFields, incidentIds: z.array(ID).max(100).optional(), assetIds: z.array(ID).max(50).optional() })
  .strict();
export const updateProblemSchema = z.object(problemFields).strict();
export const problemStatusSchema = z
  .object({
    status: z.enum(problemService.PROBLEM_STATUSES),
    comment: z.string().trim().max(2000).optional(),
    resolveLinkedIncidents: z.boolean().optional(),
  })
  .strict();
export const idsSchema = z.object({ ids: z.array(ID).min(1).max(100) }).strict();

const problemId = (req: Request) => parseId(req.params.id, "Id de problema");

// Incidentes de un problema y tickets de un cambio: solo los de los grupos de quien consulta (run-3, N2).
async function scopedProblem(req: Request, detail: problemService.ProblemDetail): Promise<problemService.ProblemDetail> {
  return { ...detail, incidents: filterTicketsInScope(detail.incidents, await resolveTicketScope(actorOf(req))) };
}

async function scopedChange(req: Request, detail: changeService.ChangeDetail): Promise<changeService.ChangeDetail> {
  return { ...detail, tickets: filterTicketsInScope(detail.tickets, await resolveTicketScope(actorOf(req))) };
}

// Vincular incidentes a un problema los modifica: exige trabajar tickets y que
// esten en los grupos del agente (run-3, F4).
async function assertCanLinkIncidents(req: Request, ticketIds: number[]): Promise<void> {
  if (!(await actorCan(req, "service-tickets", "update"))) {
    throw new ForbiddenError("Requiere permiso 'service-tickets:update' para vincular incidentes");
  }
  await assertTicketsInScope(ticketIds, await resolveTicketScope(actorOf(req)));
}

function parseList<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  const raw = queryString(value);
  if (!raw) return undefined;
  const items = raw.split(",").filter((item): item is T => (allowed as readonly string[]).includes(item));
  return items.length > 0 ? items : undefined;
}

export async function listProblems(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query }, "id", "desc", { maxLimit: 200 });
    const { items, total } = await problemService.listProblems(params, {
      statuses: parseList(req.query.statuses, problemService.PROBLEM_STATUSES),
      includeClosed: req.query.includeClosed === "true",
    });
    sendList(res, items, buildPaginationMeta(params, total), "Problemas obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function getProblem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await scopedProblem(req, await problemService.getProblemDetail(problemId(req))), "Problema obtenido");
  } catch (err) {
    next(err);
  }
}

export async function createProblem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createProblemSchema>;
    if (body.incidentIds?.length) await assertCanLinkIncidents(req, body.incidentIds);
    sendOk(res, await scopedProblem(req, await problemService.createProblem(body, requireUserId(req))), "Problema registrado", 201);
  } catch (err) {
    next(err);
  }
}

export async function updateProblem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateProblemSchema>;
    sendOk(res, await scopedProblem(req, await problemService.updateProblem(problemId(req), body, requireUserId(req))), "Problema actualizado");
  } catch (err) {
    next(err);
  }
}

export async function changeProblemStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof problemStatusSchema>;
    // Resolver incidentes en bloque es trabajar tickets: exige ese permiso (run-3, F4).
    if (body.resolveLinkedIncidents && !(await actorCan(req, "service-tickets", "update"))) {
      throw new ForbiddenError("Requiere permiso 'service-tickets:update' para resolver los incidentes vinculados");
    }
    const result = await problemService.changeProblemStatus(problemId(req), body, requireUserId(req), actorOf(req));
    sendOk(res, { ...result, problem: await scopedProblem(req, result.problem) }, "Estado del problema actualizado");
  } catch (err) {
    next(err);
  }
}

export async function linkProblemIncidents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { ids } = req.body as z.infer<typeof idsSchema>;
    await assertCanLinkIncidents(req, ids);
    sendOk(res, await scopedProblem(req, await problemService.linkIncidents(problemId(req), ids, requireUserId(req))), "Incidentes vinculados");
  } catch (err) {
    next(err);
  }
}

export async function unlinkProblemIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await assertCanLinkIncidents(req, [parseId(req.params.ticketId, "Id de ticket")]);
    sendOk(
      res,
      await scopedProblem(req, await problemService.unlinkIncident(problemId(req), parseId(req.params.ticketId, "Id de ticket"), requireUserId(req))),
      "Incidente desvinculado",
    );
  } catch (err) {
    next(err);
  }
}

export async function linkProblemAssets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { ids } = req.body as z.infer<typeof idsSchema>;
    sendOk(res, await scopedProblem(req, await problemService.linkAssets(problemId(req), ids, requireUserId(req))), "Activos vinculados");
  } catch (err) {
    next(err);
  }
}

export async function unlinkProblemAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(
      res,
      await scopedProblem(req, await problemService.unlinkAsset(problemId(req), parseId(req.params.assetId, "Id de activo"), requireUserId(req))),
      "Activo desvinculado",
    );
  } catch (err) {
    next(err);
  }
}

export async function draftKbFromProblem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await problemService.createKbDraftFromProblem(problemId(req), requireUserId(req)), "Borrador de articulo creado", 201);
  } catch (err) {
    next(err);
  }
}

// ---- Cambios --------------------------------------------------------------
const changeFields = {
  title: TEXT(160),
  description: TEXT(8000),
  justification: LONG_TEXT.nullable().optional(),
  categoryId: ID.nullable().optional(),
  risk: z.enum(changeService.CHANGE_RISKS),
  impact: LEVEL,
  implementationPlan: LONG_TEXT.nullable().optional(),
  backoutPlan: LONG_TEXT.nullable().optional(),
  testPlan: LONG_TEXT.nullable().optional(),
  plannedStart: ISO_DATETIME.nullable().optional(),
  plannedEnd: ISO_DATETIME.nullable().optional(),
  assignedGroupId: ID.nullable().optional(),
  assigneeUserId: ID.nullable().optional(),
  problemId: ID.nullable().optional(),
  assetIds: z.array(ID).max(50).optional(),
  ticketIds: z.array(ID).max(100).optional(),
};
export const createChangeSchema = z
  .object({ ...changeFields, type: z.enum(changeService.CHANGE_TYPES), templateId: ID.nullable().optional() })
  .strict();
export const updateChangeSchema = z.object(changeFields).strict();
export const changeActionSchema = z
  .object({
    action: z.enum(["submit", "request-approval", "start", "complete", "close", "cancel"]),
    approverUserIds: z.array(ID).max(changeService.MAX_CAB_APPROVERS).optional(),
    outcome: z.enum(changeService.CHANGE_OUTCOMES).optional(),
    pirNotes: LONG_TEXT.optional(),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();
export const changeDecisionSchema = z
  .object({ decision: z.enum(["APPROVED", "REJECTED"]), comment: z.string().trim().max(500).optional() })
  .strict();
export const templateSchema = z
  .object({
    name: TEXT(120),
    description: z.string().trim().max(500).nullable().optional(),
    categoryId: ID.nullable().optional(),
    implementationPlan: TEXT(8000),
    backoutPlan: TEXT(8000),
    testPlan: LONG_TEXT.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const changeId = (req: Request) => parseId(req.params.id, "Id de cambio");

function parseDate(value: unknown, label: string): Date | undefined {
  const raw = queryString(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new BadRequestError(`${label} invalida`);
  return date;
}

export async function listChanges(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query }, "id", "desc", { maxLimit: 200 });
    const from = parseDate(req.query.from, "Fecha desde");
    const to = parseDate(req.query.to, "Fecha hasta");
    if ((from && !to) || (!from && to)) throw new BadRequestError("Indique ambas fechas del calendario");
    if (from && to && to.getTime() - from.getTime() > 93 * 24 * 3600 * 1000) {
      throw new BadRequestError("El calendario admite hasta 3 meses");
    }
    const { items, total } = await changeService.listChanges(params, {
      statuses: parseList(req.query.statuses, changeService.CHANGE_STATUSES),
      includeClosed: req.query.includeClosed === "true" || Boolean(from),
      from,
      to,
      pendingApprovalFor: req.query.pendingMine === "true" ? requireUserId(req) : undefined,
    });
    sendList(res, items, buildPaginationMeta(params, total), "Cambios obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function getChange(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await scopedChange(req, await changeService.getChangeDetail(changeId(req))), "Cambio obtenido");
  } catch (err) {
    next(err);
  }
}

export async function createChange(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createChangeSchema>;
    if (body.ticketIds?.length) await assertTicketsInScope(body.ticketIds, await resolveTicketScope(actorOf(req)));
    sendOk(res, await scopedChange(req, await changeService.createChange(body, requireUserId(req))), "Cambio registrado", 201);
  } catch (err) {
    next(err);
  }
}

export async function updateChange(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateChangeSchema>;
    let input = body;
    if (body.ticketIds) {
      const scope = await resolveTicketScope(actorOf(req));
      await assertTicketsInScope(body.ticketIds, scope);
      // La lista reemplaza los vinculos: los tickets que el agente no ve se conservan (run-3 final, L1).
      const hidden = (await changeService.getChangeDetail(changeId(req))).tickets
        .filter((ticket) => !isTicketInScope(scope, ticket))
        .map((ticket) => ticket.id);
      input = { ...body, ticketIds: [...body.ticketIds, ...hidden] };
    }
    sendOk(res, await scopedChange(req, await changeService.updateChange(changeId(req), input, requireUserId(req))), "Cambio actualizado");
  } catch (err) {
    next(err);
  }
}

export async function runChangeAction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof changeActionSchema>;
    sendOk(res, await scopedChange(req, await changeService.runChangeAction(changeId(req), body, requireUserId(req))), "Cambio actualizado");
  } catch (err) {
    next(err);
  }
}

export async function decideChange(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof changeDecisionSchema>;
    sendOk(res, await scopedChange(req, await changeService.decideChange(changeId(req), body, requireUserId(req))), "Decision registrada");
  } catch (err) {
    next(err);
  }
}

export async function listTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await changeService.listTemplates({ activeOnly: req.query.all !== "true" }), "Plantillas obtenidas");
  } catch (err) {
    next(err);
  }
}

export async function listAllTemplates(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await changeService.listTemplates({ activeOnly: false }), "Plantillas obtenidas");
  } catch (err) {
    next(err);
  }
}

export async function createTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof templateSchema>;
    const template = await changeService.saveTemplate(null, { ...body, description: body.description ?? null, categoryId: body.categoryId ?? null, testPlan: body.testPlan ?? null });
    // Un cambio estandar se ejecuta sin CAB: su plantilla se audita como la configuracion (run-3, F6).
    await auditChange(req, { entity: "change-template", action: "CREATE" }, template);
    sendOk(res, template, "Plantilla creada", 201);
  } catch (err) {
    next(err);
  }
}

export async function updateTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof templateSchema>;
    const template = await changeService.saveTemplate(parseId(req.params.id, "Id de plantilla"), {
      ...body,
      description: body.description ?? null,
      categoryId: body.categoryId ?? null,
      testPlan: body.testPlan ?? null,
    });
    await auditChange(req, { entity: "change-template", action: "UPDATE" }, template);
    sendOk(res, template, "Plantilla actualizada");
  } catch (err) {
    next(err);
  }
}

// ---- Conocimiento ---------------------------------------------------------
export const articleSchema = z
  .object({
    title: TEXT(160),
    body: TEXT(20000),
    categoryId: ID.nullable().optional(),
    audience: z.enum(["PUBLIC", "INTERNAL"]),
  })
  .strict();
export const articleStatusSchema = z.object({ status: z.enum(["DRAFT", "IN_REVIEW", "PUBLISHED", "RETIRED"]) }).strict();
export const linkArticleSchema = z.object({ ticketId: ID, usedToResolve: z.boolean().default(false) }).strict();

const articleId = (req: Request) => parseId(req.params.id, "Id de articulo");

export async function listArticles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query }, "id", "desc", { maxLimit: 200 });
    const status = queryString(req.query.status);
    const { items, total } = await kbService.listArticles(params, {
      status: ["DRAFT", "IN_REVIEW", "PUBLISHED", "RETIRED"].includes(status) ? (status as kbService.KbStatus) : undefined,
    });
    sendList(res, items, buildPaginationMeta(params, total), "Articulos obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function searchArticles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Los internos solo para quien trabaja tickets o edita el conocimiento: el
    // portal tambien tiene kb-articles:read (run-3, F1).
    const internal = (await actorCan(req, "service-tickets", "read")) || (await actorCan(req, "kb-articles", "update"));
    sendOk(
      res,
      await kbService.searchPublished(queryString(req.query.search), { audience: internal ? "INTERNAL" : "PUBLIC", limit: 20 }),
      "Articulos obtenidos",
    );
  } catch (err) {
    next(err);
  }
}

export async function getArticle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const article = await kbService.getArticleOrThrow(articleId(req));
    sendOk(res, { ...article, versions: await kbService.listArticleVersions(article.id) }, "Articulo obtenido");
  } catch (err) {
    next(err);
  }
}

export async function createArticle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof articleSchema>;
    sendOk(res, await kbService.createArticle(body, requireUserId(req)), "Articulo creado", 201);
  } catch (err) {
    next(err);
  }
}

export async function updateArticle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof articleSchema>;
    sendOk(res, await kbService.updateArticle(articleId(req), body), "Articulo actualizado");
  } catch (err) {
    next(err);
  }
}

// Publicar y retirar exigen kb-articles:approve; enviar a revision o volver a borrador, solo update.
export async function changeArticleStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status } = req.body as z.infer<typeof articleStatusSchema>;
    const user = req.user!;
    const canApprove = user.roleName === "admin" || (await roleGrantsPermission(user.roleId, "kb-articles", "approve"));
    sendOk(res, await kbService.changeArticleStatus(articleId(req), status, { userId: requireUserId(req), canApprove }), "Articulo actualizado");
  } catch (err) {
    next(err);
  }
}

export async function linkArticleToTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { ticketId, usedToResolve } = req.body as z.infer<typeof linkArticleSchema>;
    await assertTicketsInScope([ticketId], await resolveTicketScope(actorOf(req)));
    await kbService.linkArticleToTicket(ticketId, articleId(req), usedToResolve, requireUserId(req));
    sendOk(res, null, "Articulo vinculado al ticket");
  } catch (err) {
    next(err);
  }
}

// ---- Indicadores ----------------------------------------------------------
export async function summary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const days = Number(queryString(req.query.days) || 30);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new BadRequestError("El periodo debe ser de 1 a 365 dias");
    sendOk(res, await reportService.getSummary(days), "Indicadores obtenidos");
  } catch (err) {
    next(err);
  }
}
