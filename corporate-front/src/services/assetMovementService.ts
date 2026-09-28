import { apiFetch, apiFetchBlob } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type {
  AssetMovement,
  AssetMovementCreateInput,
  AssignAssetInput,
  AssignmentFilters,
  AssignmentRow,
  CurrentAssignment,
  DecommissionAssetInput,
  DecommissionCheck,
  ReassignAssetInput,
} from "../types/assetMovement";
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

  // Acta de entrega en PDF (Fase E enriquecida): archivo directo, no el
  // sobre {codigo,message,data} -mismo criterio que downloadQuoteDocument.
  downloadHandover: (movementId: number) => apiFetchBlob(`/asset-movements/${movementId}/handover.pdf`),

  // Movimiento de Activos (plan 011).
  reassign: (body: ReassignAssetInput) => apiFetch<AssetMovement>("/asset-movements/reassign", { method: "POST", body }),
  // Asignacion vigente (tenedor, centro de costo y datos del acta). 404 si nadie lo tiene.
  current: (assetId: number) => apiFetch<CurrentAssignment>(`/asset-movements/current/${assetId}`),
  listAssignments: (params: ListParams & AssignmentFilters) =>
    apiFetch<Paginated<AssignmentRow>>(`/asset-movements/assignments${toQuery(params)}`),

  // Dar de baja (plan 012): revision previa (estado, clasificacion, ticket) y la baja.
  decommissionCheck: (assetId: number) => apiFetch<DecommissionCheck>(`/asset-movements/decommission/${assetId}`),
  decommission: (body: DecommissionAssetInput) =>
    apiFetch<AssetMovement>("/asset-movements/decommission", { method: "POST", body }),
};
