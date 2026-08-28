import { createContext } from "react";
import type { PendingSummary } from "../types/notification";

export interface NotificationsContextValue {
  summary: PendingSummary;
  // Refetch manual del resumen -normalmente no hace falta llamarlo a mano
  // (el push por socket ya lo dispara), pero queda expuesto para el badge
  // que quiera forzarlo (ej. al volver a foco la pestaña).
  refresh: () => Promise<void>;
}

export const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);
