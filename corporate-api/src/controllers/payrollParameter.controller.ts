import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as parameterService from "../services/mssql/payrollParameter.service";
import { sendOk } from "../library/response";
import { BadRequestError } from "../library/errors";

const codeSchema = z.enum(["IMM"]);

export const setParameterSchema = z.object({
  code: codeSchema,
  value: z.number().positive().max(999_999_999),
  validFrom: z.string().date(),
});

// GET /payroll-parameters?code=IMM -> historial de vigencias, la vigente primero.
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const code = codeSchema.safeParse(req.query.code);
    if (!code.success) throw new BadRequestError("Validacion fallida", code.error.flatten());
    sendOk(res, await parameterService.listParameters(code.data), "Parametros obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function set(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof setParameterSchema>;
    sendOk(res, await parameterService.setParameter(body, req.user?.userId), "Parametro guardado exitosamente");
  } catch (err) {
    next(err);
  }
}
