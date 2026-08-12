import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { SupplierContact, SupplierContactCreateInput, SupplierContactUpdateInput } from "../types/supplierContact";

export const supplierContactService = {
  // supplierId es obligatorio (400 si no viene).
  list: (supplierId: number, params?: ListParams) =>
    apiFetch<Paginated<SupplierContact>>(`/supplier-contacts${toQuery({ supplierId, ...params })}`),

  getById: (id: number) => apiFetch<SupplierContact>(`/supplier-contacts/${id}`),

  create: (input: SupplierContactCreateInput) =>
    apiFetch<SupplierContact>("/supplier-contacts", { method: "POST", body: input }),

  update: (id: number, input: SupplierContactUpdateInput) =>
    apiFetch<SupplierContact>(`/supplier-contacts/${id}`, { method: "PUT", body: input }),

  remove: (id: number) => apiFetch<void>(`/supplier-contacts/${id}`, { method: "DELETE" }),
};
