import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { AssetStatus, AssetStatusCreateInput, AssetStatusUpdateInput } from "../types/assetStatus";

export const assetStatusService = {
  // list/getById solo requieren estar autenticado; create/update exigen permiso -eso lo valida el backend.
  list: (params?: ListParams) => apiFetch<Paginated<AssetStatus>>(`/asset-statuses${toQuery(params)}`),
  getById: (id: number) => apiFetch<AssetStatus>(`/asset-statuses/${id}`),
  create: (body: AssetStatusCreateInput) => apiFetch<AssetStatus>("/asset-statuses", { method: "POST", body }),
  update: (id: number, body: AssetStatusUpdateInput) =>
    apiFetch<AssetStatus>(`/asset-statuses/${id}`, { method: "PUT", body }),
};
