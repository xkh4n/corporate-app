import type { NextFunction, Request, Response } from "express";
import * as notificationService from "../services/mssql/notification.service";
import { countPendingChangeApprovals } from "../services/postgres/serviceDesk/change.service";
import { getServiceDeskPendingCounts } from "../services/postgres/serviceDesk/ticket.service";
import { sendOk } from "../library/response";

// Solo los conteos del propio usuario logeado -mismo criterio que /auth/me,
// gateado unicamente con authenticate (ver notification.routes.ts), sin
// permiso adicional: cada quien puede consultar sus propios pendientes.
// Suma los del Service Desk (plan 009): tickets asignados en curso y
// aprobaciones de solicitudes y de cambios que esperan al usuario.
export async function getPendingSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const [purchases, serviceDesk, pendingChangeApprovals] = await Promise.all([
      notificationService.getPendingSummary(userId, req.user!.personId),
      getServiceDeskPendingCounts(userId),
      countPendingChangeApprovals(userId),
    ]);
    const summary = {
      ...purchases,
      ...serviceDesk,
      pendingChangeApprovals,
      total: purchases.total + serviceDesk.assignedOpenTickets + serviceDesk.pendingTicketApprovals + pendingChangeApprovals,
    };
    sendOk(res, summary, "Resumen de pendientes obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}
