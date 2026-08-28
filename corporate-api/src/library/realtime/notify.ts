import type { PurchaseRequestModel } from "../../models/mssql/purchaseRequest.model";
import { getIo } from "./socketServer";

export type NotificationReason =
  | "purchase-request-pending-approval"
  | "quote-pending-approval"
  | "purchase-order-pending";

export interface NotificationPayload {
  reason: NotificationReason;
  requestId: number;
  requestNumber: string;
  at: string;
}

type NotifiableRequest = Pick<PurchaseRequestModel, "id" | "requestNumber">;

// Best-effort, nunca lanza (mismo contrato que sendMailViaMailer en
// library/mailerClient.ts): un push en tiempo real es una mejora de UX, no
// puede tumbar la transaccion de negocio que lo dispara si el socket server
// todavia no arranco o el usuario no tiene ninguna conexion abierta en este
// momento -en ese caso el badge derivado (GET /notifications/pending-summary)
// igual queda correcto, se ve recien al proximo refetch/login.
// console.error (no library/logger.ts) a proposito: ese logger importa
// library/env.ts, que exige variables de entorno de las 4 bases de datos -
// atarlo aca rompe el contrato de *.unit.test.ts ("corren en cualquier
// lado, sin BD", ver TESTING.md) para este archivo, que de otro modo no
// depende de nada mas que socketServer.ts.
export function notifyUser(userId: number, payload: NotificationPayload): void {
  try {
    const io = getIo();
    if (!io) return;
    io.to(`user:${userId}`).emit("notifications:invalidate", payload);
  } catch (err) {
    console.error("No se pudo emitir la notificacion en tiempo real", { err, userId, payload });
  }
}

// Paso 2: nueva solicitud esperando decision del aprobador asignado.
export function notifyPendingRequestApproval(approverId: number, request: NotifiableRequest): void {
  notifyUser(approverId, {
    reason: "purchase-request-pending-approval",
    requestId: request.id,
    requestNumber: request.requestNumber,
    at: new Date().toISOString(),
  });
}

// Paso 4->5: "Solicitar Autorización" cerro la carga de cotizaciones, el
// aprobador asignado ya puede elegir la cotizacion ganadora.
export function notifyPendingQuoteApproval(approverId: number, request: NotifiableRequest): void {
  notifyUser(approverId, {
    reason: "quote-pending-approval",
    requestId: request.id,
    requestNumber: request.requestNumber,
    at: new Date().toISOString(),
  });
}

// Paso 5->6: todas las lineas aprobadas ya tienen ganador, el solicitante
// puede adjuntar la OC.
export function notifyPendingPurchaseOrder(requesterUserId: number, request: NotifiableRequest): void {
  notifyUser(requesterUserId, {
    reason: "purchase-order-pending",
    requestId: request.id,
    requestNumber: request.requestNumber,
    at: new Date().toISOString(),
  });
}
