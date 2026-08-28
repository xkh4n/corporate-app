import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type {
  SupplierServiceType,
  SupplierServiceTypeCreateInput,
  SupplierServiceTypeUpdateInput,
} from "../types/supplierServiceType";

export const supplierServiceTypeService = {
  list: (params?: ListParams) =>
    apiFetch<Paginated<SupplierServiceType>>(`/supplier-service-types${toQuery(params)}`),

  getById: (id: number) => apiFetch<SupplierServiceType>(`/supplier-service-types/${id}`),

  create: (input: SupplierServiceTypeCreateInput) =>
    apiFetch<SupplierServiceType>("/supplier-service-types", { method: "POST", body: input }),

  update: (id: number, input: SupplierServiceTypeUpdateInput) =>
    apiFetch<SupplierServiceType>(`/supplier-service-types/${id}`, { method: "PUT", body: input }),
};
