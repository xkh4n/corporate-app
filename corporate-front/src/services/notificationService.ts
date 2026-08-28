import { apiFetch } from "../lib/apiClient";
import type { PendingSummary } from "../types/notification";

export const notificationService = {
  getPendingSummary: () => apiFetch<PendingSummary>("/notifications/pending-summary"),
};
