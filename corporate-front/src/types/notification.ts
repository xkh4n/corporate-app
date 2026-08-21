// Espejo de corporate-api/src/services/mssql/notification.service.ts (PendingSummary).
export interface PendingSummary {
  pendingRequestApprovals: number;
  pendingQuoteApprovals: number;
  pendingPurchaseOrders: number;
  total: number;
}

// Espejo de corporate-api/src/library/realtime/notify.ts (NotificationPayload):
// forma del evento "notifications:invalidate" que emite el socket -una señal
// de "algo cambio, refetch", no la notificacion en si (ver NotificationsContext).
export type NotificationReason =
  | "purchase-request-pending-approval"
  | "quote-pending-approval"
  | "purchase-order-pending";

export interface NotificationPushPayload {
  reason: NotificationReason;
  requestId: number;
  requestNumber: string;
  at: string;
}
