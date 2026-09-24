import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { BadRequestError } from "../library/errors";
import { buildPaginationMeta, parsePaginationParams } from "../library/pagination";
import { sendList, sendNoContent, sendOk } from "../library/response";
import {
  CHANNELS,
  ON_HOLD_REASONS,
  PRIORITIES,
  RESOLUTION_CODES,
  TICKET_STATUSES,
  TICKET_TYPES,
  type Priority,
  type TicketStatus,
  type TicketType,
} from "../library/serviceDesk/ticketRules";
import { listAssignableUsers } from "../services/mssql/user.service";
import * as ticketService from "../services/postgres/serviceDesk/ticket.service";
import * as ticketAssetService from "../services/postgres/serviceDesk/ticketAsset.service";
import * as relatedService from "../services/postgres/serviceDesk/related.service";
import { listCatalogItems, listCategories, listGroups } from "../services/postgres/serviceDesk/settings.service";
import { resolveTicketScope } from "../services/postgres/serviceDesk/ticketScope";
import { actorOf, ID, LEVEL, optionalQueryId, parseId, queryString, sendStoredFile, TEXT } from "./serviceDesk.shared";

// Service Desk (plan 009): trabajo del agente sobre incidentes y solicitudes.

const ASSET_IDS = z.array(ID).min(1).max(ticketAssetService.MAX_ASSETS_PER_TICKET);

export const createTicketSchema = z
  .object({
    type: z.enum(TICKET_TYPES),
    title: TEXT(160),
    description: TEXT(8000),
    categoryId: ID.nullable().optional(),
    catalogItemId: ID.nullable().optional(),
    variables: z.record(z.string(), z.unknown()).optional(),
    impact: LEVEL,
    urgency: LEVEL,
    assetIds: ASSET_IDS.optional(),
    channel: z.enum(CHANNELS).optional(),
    requesterUserId: ID.optional(),
    assignedGroupId: ID.nullable().optional(),
    isMajor: z.boolean().optional(),
  })
  .strict();

export const classificationSchema = z
  .object({
    categoryId: ID.nullable().optional(),
    impact: LEVEL.optional(),
    urgency: LEVEL.optional(),
    isMajor: z.boolean().optional(),
    title: TEXT(160).optional(),
  })
  .strict();

export const assignSchema = z.object({ groupId: ID.nullable(), assigneeUserId: ID.nullable() }).strict();

export const statusSchema = z
  .object({
    status: z.enum(TICKET_STATUSES),
    onHoldReason: z.enum(ON_HOLD_REASONS).optional(),
    resolutionCode: z.enum(RESOLUTION_CODES).optional(),
    resolutionNotes: z.string().trim().max(4000).optional(),
    comment: z.string().trim().max(4000).optional(),
  })
  .strict();

export const commentSchema = z.object({ body: TEXT(8000), isPublic: z.boolean().default(true) }).strict();

export const approvalSchema = z
  .object({ decision: z.enum(["APPROVED", "REJECTED"]), comment: z.string().trim().max(500).optional() })
  .strict();

export const linkAssetsSchema = z.object({ assetIds: ASSET_IDS }).strict();
export const assetNotesSchema = z.object({ notes: z.string().trim().max(200).optional() }).strict();
export const returnAssetSchema = z
  .object({ target: z.enum(["HOLDER", "STOCK"]), notes: z.string().trim().max(200).optional() })
  .strict();

const ticketId = (req: Request) => parseId(req.params.id, "Id de ticket");
const scopeOf = (req: Request) => resolveTicketScope(actorOf(req));

function parseStatuses(value: unknown): TicketStatus[] | undefined {
  const raw = queryString(value);
  if (!raw) return undefined;
  const statuses = raw.split(",").filter((status): status is TicketStatus => (TICKET_STATUSES as readonly string[]).includes(status));
  return statuses.length > 0 ? statuses : undefined;
}

export async function lookups(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [groups, categories, catalogItems] = await Promise.all([
      listGroups({ activeOnly: true }),
      listCategories({ activeOnly: true }),
      listCatalogItems({ activeOnly: true }),
    ]);
    sendOk(res, { groups, categories, catalogItems }, "Datos de apoyo del Service Desk obtenidos");
  } catch (err) {
    next(err);
  }
}

// Solicitante de un ticket registrado por el agente: busqueda acotada, sin el listado completo de usuarios.
export async function searchUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await listAssignableUsers(queryString(req.query.search));
    sendOk(
      res,
      users.map((user) => {
        const person = (user as { person?: { firstName: string; lastName: string } }).person;
        return {
          userId: user.id,
          username: user.username,
          fullName: person ? `${person.firstName} ${person.lastName}`.trim() : user.username,
        };
      }),
      "Usuarios obtenidos",
    );
  } catch (err) {
    next(err);
  }
}

export async function searchAssets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await ticketAssetService.searchAssets(queryString(req.query.search)), "Activos obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query }, "id", "desc", {
      maxLimit: 200,
      allowedSortBy: ticketService.TICKET_SORT_FIELDS,
    });
    const view = queryString(req.query.view) as ticketService.QueueView;
    const type = queryString(req.query.type);
    const priority = queryString(req.query.priority);
    const { items, total } = await ticketService.listTickets(
      params,
      {
        view: ["all", "mine", "my-groups", "unassigned", "breached", "pending-approval"].includes(view) ? view : "all",
        statuses: parseStatuses(req.query.statuses),
        type: (TICKET_TYPES as readonly string[]).includes(type) ? (type as TicketType) : undefined,
        priority: (PRIORITIES as readonly string[]).includes(priority) ? (priority as Priority) : undefined,
        groupId: optionalQueryId(req.query.groupId, "Grupo"),
        requesterUserId: optionalQueryId(req.query.requesterUserId, "Solicitante"),
        assetId: optionalQueryId(req.query.assetId, "Activo"),
        problemId: optionalQueryId(req.query.problemId, "Problema"),
        includeClosed: req.query.includeClosed === "true",
      },
      actorOf(req),
      await scopeOf(req),
    );
    sendList(res, items, buildPaginationMeta(params, total), "Tickets obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function listApprovals(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query }, "id", "asc", { maxLimit: 200 });
    const { items, total } = await ticketService.listPendingApprovals(actorOf(req), params);
    sendList(res, items, buildPaginationMeta(params, total), "Solicitudes por aprobar obtenidas");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createTicketSchema>;
    sendOk(res, await ticketService.createTicket(body, actorOf(req), "AGENT"), "Ticket registrado", 201);
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await ticketService.getTicketDetail(ticketId(req), { audience: "agent", scope: await scopeOf(req) }), "Ticket obtenido");
  } catch (err) {
    next(err);
  }
}

export async function related(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await relatedService.getTicketRelated(ticketId(req), await scopeOf(req)), "Registros relacionados obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function updateClassification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof classificationSchema>;
    sendOk(res, await ticketService.updateClassification(ticketId(req), body, actorOf(req)), "Ticket reclasificado");
  } catch (err) {
    next(err);
  }
}

export async function assign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof assignSchema>;
    sendOk(res, await ticketService.assignTicket(ticketId(req), body, actorOf(req)), "Ticket asignado");
  } catch (err) {
    next(err);
  }
}

export async function take(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await ticketService.takeTicket(ticketId(req), actorOf(req)), "Ticket tomado");
  } catch (err) {
    next(err);
  }
}

export async function changeStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof statusSchema>;
    sendOk(res, await ticketService.changeStatus(ticketId(req), body, actorOf(req)), "Estado del ticket actualizado");
  } catch (err) {
    next(err);
  }
}

export async function comment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof commentSchema>;
    sendOk(res, await ticketService.addComment(ticketId(req), body, actorOf(req), "agent"), "Comentario agregado", 201);
  } catch (err) {
    next(err);
  }
}

export async function precheckAttachment(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    await ticketService.assertAttachmentAllowed(ticketId(req), actorOf(req), "agent");
    next();
  } catch (err) {
    next(err);
  }
}

// ?internal=true: adjunto solo visible para los agentes.
export async function uploadAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new BadRequestError("Debe adjuntar un archivo (campo 'file')");
    const attachment = await ticketService.addAttachment(ticketId(req), req.file, actorOf(req), {
      audience: "agent",
      isPublic: req.query.internal !== "true",
    });
    sendOk(res, attachment, "Adjunto agregado", 201);
  } catch (err) {
    next(err);
  }
}

export async function downloadAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = await ticketService.getAttachmentFile(ticketId(req), parseId(req.params.attachmentId, "Id de adjunto"), {
      audience: "agent",
      scope: await scopeOf(req),
    });
    sendStoredFile(res, next, file);
  } catch (err) {
    next(err);
  }
}

export async function decideApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof approvalSchema>;
    sendOk(res, await ticketService.decideApproval(ticketId(req), body, actorOf(req)), "Decision registrada");
  } catch (err) {
    next(err);
  }
}

export async function linkAssets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { assetIds } = req.body as z.infer<typeof linkAssetsSchema>;
    await ticketAssetService.linkAssets(ticketId(req), assetIds, actorOf(req));
    sendOk(res, await ticketService.getTicketDetail(ticketId(req), { audience: "agent" }), "Activos vinculados");
  } catch (err) {
    next(err);
  }
}

export async function unlinkAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await ticketAssetService.unlinkAsset(ticketId(req), parseId(req.params.assetId, "Id de activo"), actorOf(req));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

export async function sendAssetToSupport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { notes } = req.body as z.infer<typeof assetNotesSchema>;
    await ticketAssetService.sendAssetToSupport(ticketId(req), parseId(req.params.assetId, "Id de activo"), actorOf(req), notes);
    sendOk(res, await ticketService.getTicketDetail(ticketId(req), { audience: "agent" }), "Activo enviado a soporte");
  } catch (err) {
    next(err);
  }
}

export async function returnAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { target, notes } = req.body as z.infer<typeof returnAssetSchema>;
    await ticketAssetService.returnAssetFromSupport(
      ticketId(req),
      parseId(req.params.assetId, "Id de activo"),
      target,
      actorOf(req),
      notes,
    );
    sendOk(res, await ticketService.getTicketDetail(ticketId(req), { audience: "agent" }), "Activo devuelto");
  } catch (err) {
    next(err);
  }
}

export async function assetHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await ticketAssetService.listAssetServiceHistory(parseId(req.params.assetId, "Id de activo"), await scopeOf(req)), "Historial de servicio del activo obtenido");
  } catch (err) {
    next(err);
  }
}
