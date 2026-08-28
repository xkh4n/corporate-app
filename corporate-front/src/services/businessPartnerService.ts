import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { BusinessPartner, BusinessPartnerCreateInput, BusinessPartnerUpdateInput } from "../types/businessPartner";

export const businessPartnerService = {
  list: (params?: ListParams) => apiFetch<Paginated<BusinessPartner>>(`/business-partners${toQuery(params)}`),
  getById: (id: number) => apiFetch<BusinessPartner>(`/business-partners/${id}`),
  create: (body: BusinessPartnerCreateInput) =>
    apiFetch<BusinessPartner>("/business-partners", { method: "POST", body }),
  update: (id: number, body: BusinessPartnerUpdateInput) =>
    apiFetch<BusinessPartner>(`/business-partners/${id}`, { method: "PUT", body }),
};
