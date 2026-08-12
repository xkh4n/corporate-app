import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type {
  PurchaseRequestLine,
  PurchaseRequestLineCreateInput,
  PurchaseRequestLineUpdateInput,
} from "../types/purchaseRequestLine";

export const purchaseRequestLineService = {
  // requestId es obligatorio (400 si no viene).
  list: (requestId: number, params?: ListParams) =>
    apiFetch<Paginated<PurchaseRequestLine>>(`/purchase-request-lines${toQuery({ requestId, ...params })}`),

  getById: (id: number) => apiFetch<PurchaseRequestLine>(`/purchase-request-lines/${id}`),

  create: (input: PurchaseRequestLineCreateInput) =>
    apiFetch<PurchaseRequestLine>("/purchase-request-lines", { method: "POST", body: input }),

  update: (id: number, input: PurchaseRequestLineUpdateInput) =>
    apiFetch<PurchaseRequestLine>(`/purchase-request-lines/${id}`, { method: "PUT", body: input }),
};
