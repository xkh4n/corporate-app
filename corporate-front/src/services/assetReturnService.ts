import { apiFetch, apiFetchBlob } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type {
  AssetReturnCandidate,
  AssetReturnCreateInput,
  AssetReturnDetail,
  AssetReturnDocumentResult,
  AssetReturnScope,
  AssetReturnSummary,
} from "../types/assetReturn";

export const assetReturnService = {
  // Exige asset-returns:read. status: coma-separado (ej. "DRAFT,SENT").
  list: (params?: ListParams) => apiFetch<Paginated<AssetReturnSummary>>(`/asset-returns${toQuery(params)}`),
  getById: (id: number) => apiFetch<AssetReturnDetail>(`/asset-returns/${id}`),

  // Activos devolvibles. OWN: los asignados a quien consulta (costCenterId solo filtra); OTHERS: los de otro
  // usuario en el centro de costo elegido (obligatorio). Exige asset-returns:create (no assets:read).
  candidates: (query: { scope: AssetReturnScope; costCenterId?: number }, params?: ListParams) =>
    apiFetch<Paginated<AssetReturnCandidate>>(`/asset-returns/candidates${toQuery({ ...query, ...params })}`),

  // Crea el borrador (los activos siguen ASSIGNED hasta enviarlo).
  create: (body: AssetReturnCreateInput) => apiFetch<AssetReturnDetail>("/asset-returns", { method: "POST", body }),
  addLines: (id: number, assetIds: number[]) =>
    apiFetch<AssetReturnDetail>(`/asset-returns/${id}/lines`, { method: "POST", body: { assetIds } }),
  removeLine: (id: number, lineId: number) =>
    apiFetch<AssetReturnDetail>(`/asset-returns/${id}/lines/${lineId}`, { method: "DELETE" }),

  // Guia de despacho (solo PDF, multipart campo "file"). La primera vez el
  // servidor asigna el codigo, que es el nombre del archivo.
  uploadDocument: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<AssetReturnDocumentResult>(`/asset-returns/${id}/document`, { method: "POST", body: form });
  },
  // PDF directo, no el sobre {codigo,message,data}.
  downloadDocument: (id: number) => apiFetchBlob(`/asset-returns/${id}/document`),

  // "Enviar a Adquisiciones": los activos pasan a MOVE_TO_RETURNED (todo o nada).
  send: (id: number) => apiFetch<AssetReturnDetail>(`/asset-returns/${id}/send`, { method: "POST" }),
  // Recepcion en Adquisiciones (asset-returns:update). Sin lineIds = todos los pendientes.
  receive: (id: number, lineIds?: number[]) =>
    apiFetch<AssetReturnDetail>(`/asset-returns/${id}/receive`, { method: "POST", body: lineIds ? { lineIds } : {} }),
  cancel: (id: number) => apiFetch<AssetReturnDetail>(`/asset-returns/${id}/cancel`, { method: "POST" }),
};
