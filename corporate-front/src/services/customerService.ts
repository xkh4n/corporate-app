import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Customer, CustomerCreateInput } from "../types/customer";

export const customerService = {
  list: (params?: ListParams) => apiFetch<Paginated<Customer>>(`/customers${toQuery(params)}`),

  getById: (id: number) => apiFetch<Customer>(`/customers/${id}`),

  create: (input: CustomerCreateInput) => apiFetch<Customer>("/customers", { method: "POST", body: input }),
};
