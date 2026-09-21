import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as institutionService from "../services/mssql/previsionalInstitution.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList } from "../library/response";
import { BadRequestError } from "../library/errors";

// AFC (CESANTIA) no se ofrece: no es algo que se asigne por colaborador ni por
// empresa desde estas pantallas.
const listQuerySchema = z.object({ type: z.enum(["AFP", "SALUD", "CCAF", "MUTUAL"]).optional() });

// GET /previsional-institutions?type=AFP|SALUD|CCAF|MUTUAL - catalogo activo,
// alimenta los combos de asignacion. Sin type devuelve todas.
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) throw new BadRequestError("Validacion fallida", query.error.flatten());

    const params = parsePaginationParams(req.query, "name");
    const { items, total } = await institutionService.listPrevisionalInstitutions(params, query.data.type);
    sendList(res, items, buildPaginationMeta(params, total), "Instituciones previsionales obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}
