import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { AssetMovement, AssetMovementCreateInput, AssignAssetInput } from "../types/assetMovement";
import type { SafeUser } from "../types/user";

export const assetMovementService = {
  // Sin getById: solo existe listado (filtrado por assetId, obligatorio -400 si falta) y creacion.
  list: (assetId: number, params?: ListParams) =>
    apiFetch<Paginated<AssetMovement>>(`/asset-movements${toQuery({ assetId, ...params })}`),
  // Crear un movimiento tambien actualiza el statusId del Asset padre, server-side.
  create: (body: AssetMovementCreateInput) =>
    apiFetch<AssetMovement>("/asset-movements", { method: "POST", body }),

  // Picker acotado de AssignAssets.tsx (Fase E) -busqueda por RUT o nombre,
  // nunca el listado completo de usuarios (ver listAssignableUsers en
  // corporate-api/user.service.ts).
  listAssignableUsers: (search: string) =>
    apiFetch<SafeUser[]>(`/asset-movements/assignable-users${toQuery({ search })}`),

  assign: (body: AssignAssetInput) => apiFetch<AssetMovement>("/asset-movements/assign", { method: "POST", body }),
};
