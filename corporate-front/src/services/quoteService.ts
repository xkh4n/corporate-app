import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Quote, QuoteCreateInput } from "../types/quote";

export const quoteService = {
  // requestId es obligatorio (400 si no viene).
  list: (requestId: number, params?: ListParams) =>
    apiFetch<Paginated<Quote>>(`/quotes${toQuery({ requestId, ...params })}`),

  getById: (id: number) => apiFetch<Quote>(`/quotes/${id}`),

  create: (input: QuoteCreateInput) => apiFetch<Quote>("/quotes", { method: "POST", body: input }),

  // Adjunto multipart: PDF/JPEG/PNG/EML/MSG, validado por magic bytes en el servidor, 15MB max.
  uploadAttachment: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<{ filename: string }>(`/quotes/${id}/attachment`, { method: "POST", body: form });
  },
};
