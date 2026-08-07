import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as authorizationService from "../services/mssql/authorization.service";
import { BadRequestError, UnauthorizedError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export async function uploadAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new BadRequestError("Debe adjuntar un archivo (campo 'file')");
    const filename = await authorizationService.attachAuthorizationDocument(Number(req.params.id), req.file);
    sendOk(res, { filename }, "Documento de autorizacion adjuntado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export const createAuthorizationSchema = z.object({
  requestLineId: z.number().int().positive(),
  quoteId: z.number().int().positive(),
  approvedQuantity: z.number().int().positive(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.query.requestLineId) throw new BadRequestError("Debe indicar requestLineId como query param");
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await authorizationService.listAuthorizationsByLine(
      Number(req.query.requestLineId),
      params,
    );
    sendList(res, items, buildPaginationMeta(params, total), "Autorizaciones obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authorization = await authorizationService.getAuthorizationByIdOrThrow(Number(req.params.id));
    sendOk(res, authorization, "Autorizacion obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

// approverId NUNCA es input del cliente: es el usuario autenticado que hace
// la request, para que no se pueda "autorizar en nombre de otro".
export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = req.body as z.infer<typeof createAuthorizationSchema>;
    const authorization = await authorizationService.createAuthorization({
      ...body,
      approverId: req.user.userId,
    });
    sendOk(res, authorization, "Autorizacion creada exitosamente", 201);
  } catch (err) {
    next(err);
  }
}
