import type { NextFunction, Request, Response } from "express";
import * as notificationService from "../services/mssql/notification.service";
import { sendOk } from "../library/response";

// Solo los conteos del propio usuario logeado -mismo criterio que /auth/me,
// gateado unicamente con authenticate (ver notification.routes.ts), sin
// permiso adicional: cada quien puede consultar sus propios pendientes.
export async function getPendingSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const summary = await notificationService.getPendingSummary(req.user!.userId, req.user!.personId);
    sendOk(res, summary, "Resumen de pendientes obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}
