import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Asset, AssetUpdateInput } from "../types/asset";

export const assetService = {
  // Sin create: los assets se crean server-side al confirmar un GoodsReceipt, no via este recurso.
  list: (params?: ListParams) => apiFetch<Paginated<Asset>>(`/assets${toQuery(params)}`),
  getById: (id: number) => apiFetch<Asset>(`/assets/${id}`),
  update: (id: number, body: AssetUpdateInput) => apiFetch<Asset>(`/assets/${id}`, { method: "PUT", body }),
};
