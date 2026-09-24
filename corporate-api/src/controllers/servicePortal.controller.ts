import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { BadRequestError } from "../library/errors";
import { buildPaginationMeta, parsePaginationParams } from "../library/pagination";
import { sendList, sendOk } from "../library/response";
import { TICKET_TYPES } from "../library/serviceDesk/ticketRules";
import * as ticketService from "../services/postgres/serviceDesk/ticket.service";
import * as ticketAssetService from "../services/postgres/serviceDesk/ticketAsset.service";
import * as kbService from "../services/postgres/serviceDesk/kb.service";
import { listCatalogItems, listCategories } from "../services/postgres/serviceDesk/settings.service";
import { ID, LEVEL, parseId, queryString, requireUserId, sendStoredFile, TEXT } from "./serviceDesk.shared";

// Portal del solicitante (pantalla "Generar Ticket", plan 009). Todo se
// acota a los tickets del usuario autenticado: uno ajeno responde 404.

export const createPortalTicketSchema = z
  .object({
    type: z.enum(TICKET_TYPES),
    title: TEXT(160),
    description: TEXT(8000),
    categoryId: ID.nullable().optional(),
    catalogItemId: ID.nullable().optional(),
    variables: z.record(z.string(), z.unknown()).optional(),
    // impact: alcance (1 toda la empresa, 2 mi area, 3 solo yo); urgency: 1 alta .. 3 baja.
    impact: LEVEL,
    urgency: LEVEL,
    assetIds: z.array(ID).max(ticketAssetService.MAX_ASSETS_PER_TICKET).optional(),
  })
  .strict();

export const portalCommentSchema = z.object({ body: TEXT(8000) }).strict();
export const cancelSchema = z.object({ comment: z.string().trim().max(500).optional() }).strict();
export const reopenSchema = z.object({ comment: TEXT(4000) }).strict();
export const confirmSchema = z
  .object({ csatScore: z.number().int().min(1).max(5).optional(), csatComment: z.string().trim().max(500).optional() })
  .strict();
export const feedbackSchema = z.object({ helpful: z.boolean() }).strict();

const ticketId = (req: Request) => parseId(req.params.id, "Id de ticket");
const actorOf = (req: Request) => ({ userId: requireUserId(req) });

export async function catalog(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [categories, catalogItems] = await Promise.all([
      listCategories({ activeOnly: true }),
      listCatalogItems({ activeOnly: true }),
    ]);
    sendOk(
      res,
      {
        categories: categories.filter((category) => category.appliesTo.some((type) => type === "INCIDENT" || type === "SERVICE_REQUEST")),
        // El portal no necesita saber que grupos atienden cada servicio.
        catalogItems: catalogItems.map(({ defaultGroupId: _group, approvalGroupId, ...item }) => ({
          ...item,
          requiresApproval: approvalGroupId !== null,
        })),
      },
      "Catalogo de servicios obtenido",
    );
  } catch (err) {
    next(err);
  }
}

export async function myAssets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await ticketAssetService.listAssetsHeldBy(requireUserId(req)), "Activos asignados obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query }, "id", "desc", {
      maxLimit: 100,
      allowedSortBy: ticketService.TICKET_SORT_FIELDS,
    });
    const { items, total } = await ticketService.listTickets(
      params,
      { view: "all", requesterUserId: requireUserId(req), includeClosed: req.query.includeClosed === "true" },
      actorOf(req),
    );
    sendList(res, items, buildPaginationMeta(params, total), "Mis tickets obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createPortalTicketSchema>;
    const created = await ticketService.createTicket(body, actorOf(req), "PORTAL");
    sendOk(
      res,
      await ticketService.getTicketDetail(created.id, { audience: "requester", requesterUserId: requireUserId(req) }),
      "Ticket registrado",
      201,
    );
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(
      res,
      await ticketService.getTicketDetail(ticketId(req), { audience: "requester", requesterUserId: requireUserId(req) }),
      "Ticket obtenido",
    );
  } catch (err) {
    next(err);
  }
}

export async function comment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { body } = req.body as z.infer<typeof portalCommentSchema>;
    sendOk(res, await ticketService.addComment(ticketId(req), { body, isPublic: true }, actorOf(req), "requester"), "Comentario agregado", 201);
  } catch (err) {
    next(err);
  }
}

export async function precheckAttachment(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    await ticketService.assertAttachmentAllowed(ticketId(req), actorOf(req), "requester");
    next();
  } catch (err) {
    next(err);
  }
}

export async function uploadAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new BadRequestError("Debe adjuntar un archivo (campo 'file')");
    const attachment = await ticketService.addAttachment(ticketId(req), req.file, actorOf(req), { audience: "requester", isPublic: true });
    sendOk(res, attachment, "Adjunto agregado", 201);
  } catch (err) {
    next(err);
  }
}

export async function downloadAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = await ticketService.getAttachmentFile(ticketId(req), parseId(req.params.attachmentId, "Id de adjunto"), {
      audience: "requester",
      requesterUserId: requireUserId(req),
    });
    sendStoredFile(res, next, file);
  } catch (err) {
    next(err);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof cancelSchema>;
    sendOk(res, await ticketService.requesterAction(ticketId(req), "cancel", body, actorOf(req)), "Ticket anulado");
  } catch (err) {
    next(err);
  }
}

export async function reopen(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof reopenSchema>;
    sendOk(res, await ticketService.requesterAction(ticketId(req), "reopen", body, actorOf(req)), "Ticket reabierto");
  } catch (err) {
    next(err);
  }
}

export async function confirm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof confirmSchema>;
    sendOk(res, await ticketService.requesterAction(ticketId(req), "confirm", body, actorOf(req)), "Ticket cerrado");
  } catch (err) {
    next(err);
  }
}

// ---- Base de conocimiento (solo articulos publicos y publicados) ----------
export async function searchKb(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await kbService.searchPublished(queryString(req.query.search), {
        audience: "PUBLIC",
        limit: 10,
        // Sugerencias mientras el usuario escribe el titulo: alcanza con una palabra.
        anyTerm: req.query.suggest === "true",
      }), "Articulos obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function getKbArticle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await kbService.getPublishedArticle(parseId(req.params.articleId, "Id de articulo"), "PUBLIC"), "Articulo obtenido");
  } catch (err) {
    next(err);
  }
}

export async function kbFeedback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { helpful } = req.body as z.infer<typeof feedbackSchema>;
    await kbService.recordFeedback(parseId(req.params.articleId, "Id de articulo"), requireUserId(req), helpful, "PUBLIC");
    sendOk(res, null, "Gracias por su opinion");
  } catch (err) {
    next(err);
  }
}
