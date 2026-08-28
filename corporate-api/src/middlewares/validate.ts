import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { env } from "../library/env";
import { BadRequestError } from "../library/errors";

// Solo valida req.body a proposito: en Express 5, req.query/req.params son
// getters de solo lectura (ya no se pueden reasignar), asi que reescribirlos
// con el resultado parseado de Zod no es viable sin cambiar de estrategia.
export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (env.flags.disableValidation) {
      next();
      return;
    }

    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new BadRequestError("Validacion fallida", result.error.flatten()));
      return;
    }

    req.body = result.data;
    next();
  };
}
