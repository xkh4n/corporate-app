import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Supplier, SupplierCreateInput, SupplierUpdateInput } from "../types/supplier";

export const supplierService = {
  list: (params?: ListParams) => apiFetch<Paginated<Supplier>>(`/suppliers${toQuery(params)}`),

  getById: (id: number) => apiFetch<Supplier>(`/suppliers/${id}`),

  create: (input: SupplierCreateInput) => apiFetch<Supplier>("/suppliers", { method: "POST", body: input }),

  update: (id: number, input: SupplierUpdateInput) =>
    apiFetch<Supplier>(`/suppliers/${id}`, { method: "PUT", body: input }),
};
