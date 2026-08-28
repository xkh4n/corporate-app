import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type {
  SupplierDeliveryTerms,
  SupplierDeliveryTermsCreateInput,
  SupplierDeliveryTermsUpdateInput,
} from "../types/supplierDeliveryTerms";

export const supplierDeliveryTermsService = {
  list: (params?: ListParams) =>
    apiFetch<Paginated<SupplierDeliveryTerms>>(`/supplier-delivery-terms${toQuery(params)}`),

  getById: (id: number) => apiFetch<SupplierDeliveryTerms>(`/supplier-delivery-terms/${id}`),

  create: (input: SupplierDeliveryTermsCreateInput) =>
    apiFetch<SupplierDeliveryTerms>("/supplier-delivery-terms", { method: "POST", body: input }),

  update: (id: number, input: SupplierDeliveryTermsUpdateInput) =>
    apiFetch<SupplierDeliveryTerms>(`/supplier-delivery-terms/${id}`, { method: "PUT", body: input }),
};
