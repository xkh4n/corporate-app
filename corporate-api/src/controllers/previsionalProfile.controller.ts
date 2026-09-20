import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as profileService from "../services/mssql/previsionalProfile.service";
import { sendOk } from "../library/response";
import { BadRequestError } from "../library/errors";

const employeeIdParam = z.coerce.number().int().positive();

function parseEmployeeId(raw: string): number {
  const parsed = employeeIdParam.safeParse(raw);
  if (!parsed.success) throw new BadRequestError("El id del colaborador no es valido");
  return parsed.data;
}

// Tabla 4 (regimen) y Tabla 5 (tipo de trabajador) de Previred.
export const assignPensionSchema = z.object({
  regime: z.enum(["AFP", "INP", "SIP"]),
  workerType: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(8), z.literal(9)]),
  afpInstitutionId: z.number().int().positive().nullable(),
});

// Tabla 17: 1 pesos, 2 UF. El FUN (campo 76) es de hasta 16 caracteres.
export const assignHealthSchema = z.object({
  healthInstitutionId: z.number().int().positive(),
  healthFun: z.string().trim().min(1).max(16).nullable(),
  healthPlanCurrency: z.union([z.literal(1), z.literal(2)]).nullable(),
  healthAgreedAmount: z.number().positive().max(99_999_999).nullable(),
});

// GET /previsional-profiles/:employeeId -> { employeeId, profile | null, employer }
export async function getByEmployee(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const view = await profileService.getPrevisionalProfileView(parseEmployeeId(String(req.params.employeeId)));
    sendOk(res, view, "Perfil previsional obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function assignPension(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof assignPensionSchema>;
    const view = await profileService.assignPension(
      parseEmployeeId(String(req.params.employeeId)),
      body,
      req.user?.userId,
    );
    sendOk(res, view, "AFP asignada exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function assignHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof assignHealthSchema>;
    const view = await profileService.assignHealth(
      parseEmployeeId(String(req.params.employeeId)),
      body,
      req.user?.userId,
    );
    sendOk(res, view, "Salud asignada exitosamente");
  } catch (err) {
    next(err);
  }
}
