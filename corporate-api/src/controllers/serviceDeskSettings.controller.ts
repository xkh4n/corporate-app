import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { BadRequestError } from "../library/errors";
import { logger } from "../library/logger";
import { buildPaginationMeta, parsePaginationParams } from "../library/pagination";
import { sendList, sendNoContent, sendOk } from "../library/response";
import { catalogFieldsSchema, PRIORITIES, TICKET_TYPES } from "../library/serviceDesk/ticketRules";
import { listSettingsAudit, recordSettingsChange, type AuditAction } from "../services/postgres/serviceDesk/audit.service";
import * as settings from "../services/postgres/serviceDesk/settings.service";
import { actorOf, ID, LEVEL, parseId, queryString, requireUserId, TEXT } from "./serviceDesk.shared";

// Configuracion del Service Desk (plan 009): grupos, categorias, catalogo,
// calendario habil, matriz de prioridad y SLA.

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato esperado: HH:MM");
const DATE = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Formato esperado: AAAA-MM-DD");
const EMAIL = z.string().trim().email().max(160);

export const groupSchema = z
  .object({
    name: TEXT(80),
    description: z.string().trim().max(255).nullable().optional(),
    email: EMAIL.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const membersSchema = z
  .object({ members: z.array(z.object({ userId: ID, isLead: z.boolean().default(false) }).strict()).max(200) })
  .strict();

export const categorySchema = z
  .object({
    parentId: ID.nullable().optional(),
    name: TEXT(80),
    defaultGroupId: ID.nullable().optional(),
    appliesTo: z.array(z.enum(["INCIDENT", "SERVICE_REQUEST", "PROBLEM", "CHANGE"])).min(1),
    isActive: z.boolean().optional(),
  })
  .strict();

export const catalogItemSchema = z
  .object({
    name: TEXT(120),
    description: z.string().trim().max(500).nullable().optional(),
    categoryId: ID.nullable().optional(),
    defaultGroupId: ID.nullable().optional(),
    approvalGroupId: ID.nullable().optional(),
    fields: catalogFieldsSchema,
    isActive: z.boolean().optional(),
  })
  .strict();

export const calendarSchema = z
  .object({
    name: TEXT(80),
    timezone: TEXT(60),
    hours: z.array(z.object({ weekday: z.number().int().min(1).max(7), start: HHMM, end: HHMM }).strict()).min(1).max(21),
  })
  .strict();

export const holidaySchema = z.object({ date: DATE, name: TEXT(120) }).strict();

export const matrixSchema = z
  .object({ rows: z.array(z.object({ impact: LEVEL, urgency: LEVEL, priority: z.enum(PRIORITIES) }).strict()).length(9) })
  .strict();

export const slaSchema = z
  .object({
    policies: z
      .array(
        z
          .object({
            ticketType: z.enum(TICKET_TYPES),
            priority: z.enum(PRIORITIES),
            // Hasta 1 anio de minutos habiles.
            responseMinutes: z.number().int().min(1).max(525_600),
            resolutionMinutes: z.number().int().min(1).max(525_600),
            calendarId: ID.nullable().optional(),
          })
          .strict()
          .refine((policy) => policy.resolutionMinutes >= policy.responseMinutes, {
            message: "La resolucion no puede ser menor que la respuesta",
          }),
      )
      .min(1)
      .max(8),
  })
  .strict();

const idParam = (req: Request) => parseId(req.params.id, "Id");

type Handler = (req: Request) => Promise<unknown>;

// Todos los handlers de esta pantalla tienen la misma forma: ejecutar y responder.
// audit: los cambios confirmados quedan en service_desk_audit_log (run-3, F6).
function handle(fn: Handler, message: string, status = 200, audit?: { entity: string; action: AuditAction }) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await fn(req);
      if (audit) await auditChange(req, audit, data);
      if (data === undefined) sendNoContent(res);
      else sendOk(res, data, message, status);
    } catch (err) {
      next(err);
    }
  };
}

export async function auditChange(req: Request, audit: { entity: string; action: AuditAction }, data: unknown): Promise<void> {
  const paramId = Number(req.params.id);
  const dataId = (data as { id?: unknown } | undefined)?.id;
  const entry = {
    entity: audit.entity,
    entityId: Number.isInteger(paramId) && paramId > 0 ? paramId : typeof dataId === "number" ? dataId : null,
    action: audit.action,
    actorUserId: requireUserId(req),
    payload: { body: req.body ?? null, params: req.params },
  };
  try {
    await recordSettingsChange(entry);
  } catch (err) {
    // El cambio ya se confirmo: no se informa como fallido, pero la falta de registro queda en el log.
    logger.error({ err, audit: { ...entry, payload: undefined } }, "No se pudo registrar la auditoria de configuracion del Service Desk");
  }
}

export async function listAudit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query }, "id", "desc", { maxLimit: 100 });
    const entity = queryString(req.query.entity);
    const { items, total } = await listSettingsAudit(params, { entity: /^[a-z-]{1,40}$/.test(entity) ? entity : undefined });
    sendList(res, items, buildPaginationMeta(params, total), "Auditoria obtenida");
  } catch (err) {
    next(err);
  }
}

export const listGroups = handle(() => settings.listGroups(), "Grupos obtenidos");
export const createGroup = handle((req) => settings.createGroup(req.body as z.infer<typeof groupSchema>), "Grupo creado", 201, {
  entity: "group",
  action: "CREATE",
});
export const updateGroup = handle(
  (req) => settings.updateGroup(idParam(req), req.body as z.infer<typeof groupSchema>),
  "Grupo actualizado",
  200,
  { entity: "group", action: "UPDATE" },
);
export const replaceMembers = handle(
  (req) => settings.replaceGroupMembers(idParam(req), (req.body as z.infer<typeof membersSchema>).members, actorOf(req)),
  "Miembros actualizados",
  200,
  { entity: "group-members", action: "REPLACE" },
);

export const listCategories = handle(() => settings.listCategories(), "Categorias obtenidas");
export const createCategory = handle((req) => settings.createCategory(req.body as z.infer<typeof categorySchema>), "Categoria creada", 201, {
  entity: "category",
  action: "CREATE",
});
export const updateCategory = handle(
  (req) => settings.updateCategory(idParam(req), req.body as z.infer<typeof categorySchema>),
  "Categoria actualizada",
  200,
  { entity: "category", action: "UPDATE" },
);

export const listCatalogItems = handle(() => settings.listCatalogItems(), "Catalogo obtenido");
export const createCatalogItem = handle(
  (req) => settings.createCatalogItem(req.body as z.infer<typeof catalogItemSchema>),
  "Item de catalogo creado",
  201,
  { entity: "catalog-item", action: "CREATE" },
);
export const updateCatalogItem = handle(
  (req) => settings.updateCatalogItem(idParam(req), req.body as z.infer<typeof catalogItemSchema>),
  "Item de catalogo actualizado",
  200,
  { entity: "catalog-item", action: "UPDATE" },
);

export const listCalendars = handle(() => settings.listCalendars(), "Calendarios obtenidos");
export const updateCalendar = handle(
  (req) => settings.updateCalendar(idParam(req), req.body as z.infer<typeof calendarSchema>),
  "Calendario actualizado",
  200,
  { entity: "calendar", action: "UPDATE" },
);
export const addHoliday = handle(async (req) => {
  const { date, name } = req.body as z.infer<typeof holidaySchema>;
  await settings.addHoliday(idParam(req), date, name);
  return (await settings.listCalendars()).find((calendar) => calendar.id === idParam(req));
}, "Feriado guardado", 200, { entity: "holiday", action: "CREATE" });
export const removeHoliday = handle(async (req) => {
  const date = String(req.params.date ?? "");
  if (!DATE.safeParse(date).success) throw new BadRequestError("Fecha invalida (AAAA-MM-DD)");
  await settings.removeHoliday(idParam(req), date);
  return undefined;
}, "Feriado eliminado", 200, { entity: "holiday", action: "DELETE" });

export const getMatrix = handle(() => settings.listPriorityMatrix(), "Matriz de prioridad obtenida");
export const replaceMatrix = handle(
  (req) => settings.replacePriorityMatrix((req.body as z.infer<typeof matrixSchema>).rows),
  "Matriz de prioridad actualizada",
  200,
  { entity: "priority-matrix", action: "REPLACE" },
);

export const listSla = handle(() => settings.listSlaPolicies(), "Politicas de SLA obtenidas");
export const upsertSla = handle(
  (req) =>
    settings.upsertSlaPolicies(
      (req.body as z.infer<typeof slaSchema>).policies.map((policy) => ({ ...policy, calendarId: policy.calendarId ?? null })),
    ),
  "Politicas de SLA actualizadas",
  200,
  { entity: "sla-policies", action: "REPLACE" },
);
