import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { CostCenter, CostCenterCreateInput, CostCenterUpdateInput } from "../types/costCenter";

export const costCenterService = {
  // list/getById solo requieren estar autenticado; create/update exigen permiso -eso lo valida el backend.
  list: (params?: ListParams) => apiFetch<Paginated<CostCenter>>(`/cost-centers${toQuery(params)}`),
  getById: (id: number) => apiFetch<CostCenter>(`/cost-centers/${id}`),
  create: (body: CostCenterCreateInput) => apiFetch<CostCenter>("/cost-centers", { method: "POST", body }),
  update: (id: number, body: CostCenterUpdateInput) =>
    apiFetch<CostCenter>(`/cost-centers/${id}`, { method: "PUT", body }),
};
