import { apiFetch, apiFetchBlob } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type {
  PurchaseRequest,
  PurchaseRequestCreateInput,
  PurchaseRequestStatus,
  PurchaseRequestUpdateInput,
} from "../types/purchaseRequest";

export const purchaseRequestService = {
  list: (params?: ListParams) => apiFetch<Paginated<PurchaseRequest>>(`/purchase-requests${toQuery(params)}`),

  getById: (id: number) => apiFetch<PurchaseRequest>(`/purchase-requests/${id}`),

  create: (input: PurchaseRequestCreateInput) =>
    apiFetch<PurchaseRequest>("/purchase-requests", { method: "POST", body: input }),

  update: (id: number, input: PurchaseRequestUpdateInput) =>
    apiFetch<PurchaseRequest>(`/purchase-requests/${id}`, { method: "PUT", body: input }),

  updateStatus: (id: number, status: PurchaseRequestStatus) =>
    apiFetch<PurchaseRequest>(`/purchase-requests/${id}/status`, { method: "PATCH", body: { status } }),

  // Descarga el PDF de cotizacion (stream binario, no JSON envelope).
  downloadQuoteDocument: (id: number, supplierId?: number) =>
    apiFetchBlob(`/purchase-requests/${id}/quote-document${toQuery({ supplierId })}`),

  listQuoteDocuments: (id: number) =>
    apiFetch<{ files: string[] }>(`/purchase-requests/${id}/quote-documents`),

  // Descarga un archivo puntual ya subido (stream binario, no JSON envelope).
  downloadQuoteDocumentFile: (id: number, filename: string) =>
    apiFetchBlob(`/purchase-requests/${id}/quote-documents/${filename}`),

  sendQuoteEmail: (id: number, supplierId: number) =>
    apiFetch<{ sent: true }>(`/purchase-requests/${id}/send-quote-email`, {
      method: "POST",
      body: { supplierId },
    }),
};
