import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as authorizationService from "../services/mssql/authorization.service";
import { BadRequestError, UnauthorizedError } from "../library/errors";

export const createAuthorizationSchema = z.object({
  requestLineId: z.number().int().positive(),
  quoteId: z.number().int().positive(),
  approvedQuantity: z.number().int().positive(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.query.requestLineId) throw new BadRequestError("Debe indicar requestLineId como query param");
    res.json(await authorizationService.listAuthorizationsByLine(Number(req.query.requestLineId)));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await authorizationService.getAuthorizationByIdOrThrow(Number(req.params.id)));
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
    res
      .status(201)
      .json(await authorizationService.createAuthorization({ ...body, approverId: req.user.userId }));
  } catch (err) {
    next(err);
  }
}
