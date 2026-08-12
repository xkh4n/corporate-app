import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { AssetMovement, AssetMovementCreateInput } from "../types/assetMovement";

export const assetMovementService = {
  // Sin getById: solo existe listado (filtrado por assetId, obligatorio -400 si falta) y creacion.
  list: (assetId: number, params?: ListParams) =>
    apiFetch<Paginated<AssetMovement>>(`/asset-movements${toQuery({ assetId, ...params })}`),
  // Crear un movimiento tambien actualiza el statusId del Asset padre, server-side.
  create: (body: AssetMovementCreateInput) =>
    apiFetch<AssetMovement>("/asset-movements", { method: "POST", body }),
};
