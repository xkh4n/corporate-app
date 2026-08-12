import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { PurchaseOrder, PurchaseOrderCreateInput } from "../types/purchaseOrder";

export const purchaseOrderService = {
  list: (params?: ListParams) => apiFetch<Paginated<PurchaseOrder>>(`/purchase-orders${toQuery(params)}`),

  getById: (id: number) => apiFetch<PurchaseOrder>(`/purchase-orders/${id}`),

  create: (input: PurchaseOrderCreateInput) =>
    apiFetch<PurchaseOrder>("/purchase-orders", { method: "POST", body: input }),
};
