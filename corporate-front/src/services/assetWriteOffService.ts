import { apiFetch, apiFetchBlob } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type {
  EligibleWriteOffAsset,
  WriteOffDetail,
  WriteOffPhoto,
  WriteOffSummary,
  WriteOffUpdate,
} from "../types/assetWriteOff";

function fileForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

// Baja contable de activos (plan 008). "status" de ListParams filtra por
// estado de la baja (DRAFT o CONFIRMED).
export const assetWriteOffService = {
  listEligible: (params?: ListParams) =>
    apiFetch<Paginated<EligibleWriteOffAsset>>(`/asset-write-offs/eligible${toQuery(params)}`),

  list: (params?: ListParams) => apiFetch<Paginated<WriteOffSummary>>(`/asset-write-offs${toQuery(params)}`),

  get: (id: number) => apiFetch<WriteOffDetail>(`/asset-write-offs/${id}`),

  create: (assetIds: number[]) => apiFetch<WriteOffDetail>("/asset-write-offs", { method: "POST", body: { assetIds } }),

  update: (id: number, input: WriteOffUpdate) =>
    apiFetch<WriteOffDetail>(`/asset-write-offs/${id}`, { method: "PUT", body: input }),

  discard: (id: number) => apiFetch<void>(`/asset-write-offs/${id}`, { method: "DELETE" }),

  uploadCertificate: (id: number, file: File) =>
    apiFetch<WriteOffDetail>(`/asset-write-offs/${id}/certificate`, { method: "POST", body: fileForm(file) }),

  downloadCertificate: (id: number) => apiFetchBlob(`/asset-write-offs/${id}/certificate`),

  uploadPhoto: (id: number, assetId: number, file: File) =>
    apiFetch<WriteOffPhoto>(`/asset-write-offs/${id}/assets/${assetId}/photos`, { method: "POST", body: fileForm(file) }),

  // Va directo en <img src>: la cookie de sesion viaja sola (mismo origen).
  photoUrl: (id: number, photoId: number) => `/api/asset-write-offs/${id}/photos/${photoId}`,

  removePhoto: (id: number, photoId: number) =>
    apiFetch<void>(`/asset-write-offs/${id}/photos/${photoId}`, { method: "DELETE" }),

  confirm: (id: number) => apiFetch<WriteOffDetail>(`/asset-write-offs/${id}/confirm`, { method: "POST", body: {} }),
};
