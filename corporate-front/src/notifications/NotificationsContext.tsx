import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth/useAuth";
import { socket } from "../lib/socket";
import { notificationService } from "../services";
import { showInfoToast } from "../components/Toast";
import type { NotificationPushPayload, PendingSummary } from "../types/notification";
import { NotificationsContext } from "./context";

const EMPTY_SUMMARY: PendingSummary = {
  pendingRequestApprovals: 0,
  pendingQuoteApprovals: 0,
  pendingPurchaseOrders: 0,
  assignedOpenTickets: 0,
  pendingTicketApprovals: 0,
  pendingChangeApprovals: 0,
  total: 0,
};

const REASON_MESSAGES: Record<NotificationPushPayload["reason"], (requestNumber: string) => string> = {
  "purchase-request-pending-approval": (n) => `Nueva solicitud ${n} pendiente de tu aprobación`,
  "quote-pending-approval": (n) => `Cotización de la solicitud ${n} lista para autorizar`,
  "purchase-order-pending": (n) => `Cotización de ${n} aprobada: ya podés adjuntar la orden de compra`,
  // Service Desk (plan 009): requestNumber lleva el folio (INC-/REQ-/PRB-/CHG-).
  "ticket-assigned": (n) => `Nuevo ticket en su cola: ${n}`,
  "ticket-updated": (n) => `${n} tiene novedades`,
  "ticket-approval-pending": (n) => `La solicitud ${n} espera su aprobación`,
  "sla-warning": (n) => `${n}: el SLA está en riesgo`,
  "sla-breached": (n) => `${n}: SLA vencido`,
  "problem-assigned": (n) => `Se le asignó el problema ${n}`,
  "change-approval-pending": (n) => `El cambio ${n} espera su aprobación (CAB)`,
  "kb-review-pending": (n) => `El artículo ${n} espera revisión`,
};

// Contexto hermano de AuthContext, no mezclado con el: AuthContext lo
// consumen ProtectedRoute/AppRoutes/todo RequirePermissions, y un valor que
// cambia en cada push ahi re-renderizaria el arbol de rutas completo. Este
// contexto aislado (mismo ciclo de vida, useAuth().status) solo re-renderiza
// lo que realmente consume el badge.
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [summary, setSummary] = useState<PendingSummary>(EMPTY_SUMMARY);

  const refresh = useCallback(async () => {
    try {
      const data = await notificationService.getPendingSummary();
      setSummary(data);
    } catch {
      // Silencioso: un fallo puntual de este badge no debe interrumpir al
      // usuario -se reintenta en el proximo push/reconexion/login.
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") {
      socket.disconnect();
      setSummary(EMPTY_SUMMARY);
      return;
    }

    socket.connect();
    void refresh();

    function handleInvalidate(payload: NotificationPushPayload): void {
      void refresh();
      const buildMessage = REASON_MESSAGES[payload.reason];
      showInfoToast(buildMessage ? buildMessage(payload.requestNumber) : `Solicitud ${payload.requestNumber} actualizada`);
    }

    // Al reconectar (ej. tras que la replica que sostenia el socket se haya
    // reiniciado) el conteo puede haber quedado desfasado mientras estuvo
    // caido -se refetchea, no se asume que sigue vigente.
    function handleConnect(): void {
      void refresh();
    }

    socket.on("notifications:invalidate", handleInvalidate);
    socket.on("connect", handleConnect);

    return () => {
      socket.off("notifications:invalidate", handleInvalidate);
      socket.off("connect", handleConnect);
      socket.disconnect();
    };
  }, [status, refresh]);

  return <NotificationsContext.Provider value={{ summary, refresh }}>{children}</NotificationsContext.Provider>;
}
