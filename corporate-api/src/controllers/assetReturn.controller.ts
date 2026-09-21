import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as assetReturnService from "../services/postgres/assetReturn.service";
import type { AssetReturnActor } from "../types/postgres/assetReturn.types";
import { BadRequestError, UnauthorizedError } from "../library/errors";
import { buildPaginationMeta, parsePaginationParams } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

const MAX_ASSETS_PER_RETURN = 100;

const assetIdsSchema = z
  .array(z.number().int().positive())
  .min(1)
  .max(MAX_ASSETS_PER_RETURN)
  .refine((ids) => new Set(ids).size === ids.length, { message: "Los activos no pueden repetirse" });

const scopeSchema = z.enum(["OWN", "OTHERS"]);

// scope OWN ("mis equipos"): el centro de costo lo define el activo (si se envia debe coincidir);
// OTHERS: el solicitante lo elige y es obligatorio (lo valida el servicio).
export const createAssetReturnSchema = z.object({
  scope: scopeSchema.default("OTHERS"),
  costCenterId: z.number().int().positive().optional(),
  assetIds: assetIdsSchema,
  notes: z.string().max(500).nullish(),
});

export const addAssetReturnLinesSchema = z.object({
  assetIds: assetIdsSchema,
});

// lineIds omitido = recibir todos los activos pendientes.
export const receiveAssetReturnSchema = z.object({
  lineIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(MAX_ASSETS_PER_RETURN)
    .refine((ids) => new Set(ids).size === ids.length, { message: "Las líneas no pueden repetirse" })
    .optional(),
});

function parseId(value: unknown, label: string): number {
  const id = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError(`${label} invalido`);
  return id;
}

function requireUserId(req: Request): number {
  const userId = req.user?.userId;
  if (userId === undefined) throw new UnauthorizedError();
  return userId;
}

// El rol sale de la sesion autenticada, nunca del cuerpo de la request.
function requireActor(req: Request): AssetReturnActor {
  return { userId: requireUserId(req), isAdmin: req.user?.roleName === "admin" };
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id", "desc", {
      allowedSortBy: ["id", "code", "status", "createdAt", "sentAt"],
      maxLimit: 500,
    });
    const { items, total } = await assetReturnService.listAssetReturns(params);
    sendList(res, items, buildPaginationMeta(params, total), "Devoluciones obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

// Activos que se pueden agregar a una devolucion: los asignados al solicitante (scope=OWN) o los de otro
// usuario en el centro de costo elegido (scope=OTHERS, por defecto). Detras del permiso "create" de esta
// pantalla, para no exigir assets:read.
export async function candidates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsedScope = scopeSchema.safeParse(req.query.scope ?? "OTHERS");
    if (!parsedScope.success) throw new BadRequestError("scope debe ser OWN u OTHERS");
    const scope = parsedScope.data;
    const costCenterId = req.query.costCenterId === undefined ? null : parseId(req.query.costCenterId, "Centro de costo");
    // sortBy acotado: sin lista, ?sortBy=value dejaba deducir el ranking de valor de los activos.
    const params = parsePaginationParams({ ...req.query }, "tag", "asc", {
      allowedSortBy: ["id", "tag", "serialNumber"],
      maxLimit: 200,
    });
    const { items, total } = await assetReturnService.listReturnCandidates(
      { scope, costCenterId, actor: requireActor(req) },
      params,
    );
    sendList(res, items, buildPaginationMeta(params, total), "Activos devolvibles obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createAssetReturnSchema>;
    const actor = requireActor(req);
    const detail = await assetReturnService.createAssetReturn({ ...body, requestedBy: actor.userId, isAdmin: actor.isAdmin });
    sendOk(res, detail, "Devolución creada en borrador", 201);
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const detail = await assetReturnService.getAssetReturnDetail(parseId(req.params.id, "Id de devolución"));
    sendOk(res, detail, "Devolución obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function addLines(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof addAssetReturnLinesSchema>;
    const detail = await assetReturnService.addAssetReturnLines(
      parseId(req.params.id, "Id de devolución"),
      body.assetIds,
      requireActor(req),
    );
    sendOk(res, detail, "Activos agregados a la devolución");
  } catch (err) {
    next(err);
  }
}

export async function removeLine(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const detail = await assetReturnService.removeAssetReturnLine(
      parseId(req.params.id, "Id de devolución"),
      parseId(req.params.lineId, "Id de línea"),
      requireActor(req),
    );
    sendOk(res, detail, "Activo quitado de la devolución");
  } catch (err) {
    next(err);
  }
}

// Sube la guia de despacho (multipart, campo "file", solo PDF).
export async function uploadDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new BadRequestError("Debe adjuntar un archivo (campo 'file')");
    const result = await assetReturnService.attachAssetReturnDocument(
      parseId(req.params.id, "Id de devolución"),
      req.file,
      requireActor(req),
    );
    sendOk(res, result, "Guía de despacho adjuntada exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

// Va ANTES de uploadSingle en la ruta (ver assertDocumentUploadAllowed).
export async function precheckDocumentUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await assetReturnService.assertDocumentUploadAllowed(parseId(req.params.id, "Id de devolución"), requireActor(req));
    next();
  } catch (err) {
    next(err);
  }
}

// La guia se entrega SOLO como descarga (attachment): no se abre en el visor del navegador. Ademas
// es la reescritura de qpdf, ya sin contenido activo (library/pdfSanitizer.ts).
export async function downloadDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { filePath, filename } = await assetReturnService.getAssetReturnDocument(parseId(req.params.id, "Id de devolución"));
    res.sendFile(
      filePath,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          // Documento interno: sin cache compartida ni del navegador.
          "Cache-Control": "private, no-store",
        },
      },
      (err) => {
        if (err) next(err);
      },
    );
  } catch (err) {
    next(err);
  }
}

export async function send(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const detail = await assetReturnService.sendAssetReturn(parseId(req.params.id, "Id de devolución"), requireActor(req));
    sendOk(res, detail, "Devolución enviada a Adquisiciones");
  } catch (err) {
    next(err);
  }
}

export async function receive(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof receiveAssetReturnSchema>;
    const detail = await assetReturnService.receiveAssetReturn(
      parseId(req.params.id, "Id de devolución"),
      body.lineIds,
      requireActor(req),
    );
    sendOk(res, detail, "Recepción registrada");
  } catch (err) {
    next(err);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const detail = await assetReturnService.cancelAssetReturn(parseId(req.params.id, "Id de devolución"), requireActor(req));
    sendOk(res, detail, "Devolución cancelada");
  } catch (err) {
    next(err);
  }
}
