import { apiFetch, apiFetchBlob } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { PurchaseOrder, PurchaseOrderCreateInput } from "../types/purchaseOrder";

export const purchaseOrderService = {
  // requestId opcional: filtra a las ordenes de UNA solicitud puntual (ver
  // AttachPurchaseOrder.tsx/SendPurchaseOrder.tsx).
  list: (params?: ListParams & { requestId?: number }) =>
    apiFetch<Paginated<PurchaseOrder>>(`/purchase-orders${toQuery(params)}`),

  getById: (id: number) => apiFetch<PurchaseOrder>(`/purchase-orders/${id}`),

  create: (input: PurchaseOrderCreateInput) =>
    apiFetch<PurchaseOrder>("/purchase-orders", { method: "POST", body: input }),

  // Adjunto multipart: PDF/JPEG/PNG/EML/MSG, validado por magic bytes en el servidor, 15MB max.
  uploadAttachment: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<{ filename: string }>(`/purchase-orders/${id}/attachment`, { method: "POST", body: form });
  },

  listDocuments: (id: number) => apiFetch<{ files: string[] }>(`/purchase-orders/${id}/documents`),

  // Descarga un archivo puntual ya subido/consolidado (stream binario, no JSON envelope).
  downloadDocumentFile: (id: number, filename: string) =>
    apiFetchBlob(`/purchase-orders/${id}/documents/${encodeURIComponent(filename)}`),

  sendToSupplier: (id: number) =>
    apiFetch<{ sent: true }>(`/purchase-orders/${id}/send-to-supplier`, { method: "POST" }),
};
