import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Authorization, AuthorizationCreateInput } from "../types/authorization";

export const authorizationService = {
  // requestLineId es obligatorio (400 si no viene).
  list: (requestLineId: number, params?: ListParams) =>
    apiFetch<Paginated<Authorization>>(`/authorizations${toQuery({ requestLineId, ...params })}`),

  getById: (id: number) => apiFetch<Authorization>(`/authorizations/${id}`),

  create: (input: AuthorizationCreateInput) =>
    apiFetch<Authorization>("/authorizations", { method: "POST", body: input }),

  // Adjunto multipart: mismas restricciones de tipo/tamano que quotes.
  uploadAttachment: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<{ filename: string }>(`/authorizations/${id}/attachment`, { method: "POST", body: form });
  },
};
