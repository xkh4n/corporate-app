import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as settingsService from "../services/mssql/previredSettings.service";
import { sendOk } from "../library/response";

// mutualBranchCode es 9(3) en el formato (campo 99); workAccidentRate es un
// porcentaje (base + adicional + Ley SANNA, la informa la mutual/ISL).
export const saveSettingsSchema = z.object({
  ccafInstitutionId: z.number().int().positive().nullable(),
  mutualInstitutionId: z.number().int().positive().nullable(),
  mutualBranchCode: z.number().int().min(0).max(999).nullable(),
  workAccidentRate: z.number().min(0).max(100).nullable(),
});

// GET /previred-settings -> la configuracion o null si aun no se define.
export async function get(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await settingsService.getEmployerSettings(), "Configuracion previsional obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function save(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof saveSettingsSchema>;
    const settings = await settingsService.saveEmployerSettings(body, req.user?.userId);
    sendOk(res, settings, "Configuracion previsional guardada exitosamente");
  } catch (err) {
    next(err);
  }
}
