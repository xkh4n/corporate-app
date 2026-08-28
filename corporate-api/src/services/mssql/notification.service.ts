import { Op } from "sequelize";
import { PurchaseRequestModel } from "../../models/mssql/purchaseRequest.model";

export interface PendingSummary {
  pendingRequestApprovals: number;
  pendingQuoteApprovals: number;
  pendingPurchaseOrders: number;
  total: number;
}

// Derivado de purchase_requests.status en el momento de la consulta, no de
// una tabla de notificaciones persistidas -ver seccion B.1 del plan
// ("el socket es una señal de invalidar/refetch"): el push en tiempo real
// (notify.ts) le avisa al cliente CUANDO refrescar, pero el numero real
// siempre sale de aca, asi que nunca puede desincronizarse del estado real
// de las solicitudes.
export async function getPendingSummary(userId: number, personId: number): Promise<PendingSummary> {
  const [pendingRequestApprovals, pendingQuoteApprovals, pendingPurchaseOrders] = await Promise.all([
    PurchaseRequestModel.count({
      where: { approverId: userId, status: { [Op.in]: ["DRAFT", "SUBMITTED"] } },
    }),
    PurchaseRequestModel.count({ where: { approverId: userId, status: "APPROVE_QUOTE" } }),
    // requesterId es un personId, no un userId -distinto de los dos de arriba.
    PurchaseRequestModel.count({ where: { requesterId: personId, status: "QUOTE_APPROVED" } }),
  ]);

  return {
    pendingRequestApprovals,
    pendingQuoteApprovals,
    pendingPurchaseOrders,
    total: pendingRequestApprovals + pendingQuoteApprovals + pendingPurchaseOrders,
  };
}
