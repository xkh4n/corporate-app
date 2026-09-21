import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as settingsService from "../services/mssql/payrollSettings.service";
import { sendOk } from "../library/response";

export const savePayrollSettingsSchema = z.object({
  gratificationSystem: z.enum(["ART47", "ART50", "CONVENCIONAL"]).nullable(),
  // Requerido (null = sin anticipo): omitirlo borraria el valor guardado sin avisar.
  gratificationMonthlyAdvancePercentage: z.number().positive().max(100).nullable(),
});

// GET /payroll-settings -> la configuracion o null si aun no se define.
export async function get(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await settingsService.getPayrollSettings(), "Configuracion de remuneraciones obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function save(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof savePayrollSettingsSchema>;
    const settings = await settingsService.savePayrollSettings(body, req.user?.userId);
    sendOk(res, settings, "Configuracion de remuneraciones guardada exitosamente");
  } catch (err) {
    next(err);
  }
}
