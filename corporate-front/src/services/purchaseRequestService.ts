import { apiFetch, apiFetchBlob } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type {
  PurchaseRequest,
  PurchaseRequestCreateInput,
  PurchaseRequestStatus,
  PurchaseRequestUpdateInput,
} from "../types/purchaseRequest";
import type { SafeUser } from "../types/user";

export const purchaseRequestService = {
  list: (params?: ListParams) => apiFetch<Paginated<PurchaseRequest>>(`/purchase-requests${toQuery(params)}`),

  // Usuarios activos cuyo rol tiene purchase-requests:approve -para el
  // select de aprobador en CreateRequest.tsx.
  listApprovers: () => apiFetch<SafeUser[]>("/purchase-requests/approvers"),

  // Solo lo que le corresponde revisar al usuario logeado (AproveRequest.tsx)
  // -exige purchase-requests:approve, no purchase-requests:read.
  listMyApprovals: (params?: ListParams) =>
    apiFetch<Paginated<PurchaseRequest>>(`/purchase-requests/my-approvals${toQuery(params)}`),

  // Solo lo que le corresponde SEGUIR al solicitante logeado (badge de
  // notificaciones de la Fase B, AttachPurchaseOrder.tsx de la Fase C) -exige
  // purchase-requests:create, no purchase-requests:read.
  listMyRequests: (params?: ListParams) =>
    apiFetch<Paginated<PurchaseRequest>>(`/purchase-requests/my-requests${toQuery(params)}`),

  getById: (id: number) => apiFetch<PurchaseRequest>(`/purchase-requests/${id}`),

  create: (input: PurchaseRequestCreateInput) =>
    apiFetch<PurchaseRequest>("/purchase-requests", { method: "POST", body: input }),

  update: (id: number, input: PurchaseRequestUpdateInput) =>
    apiFetch<PurchaseRequest>(`/purchase-requests/${id}`, { method: "PUT", body: input }),

  updateStatus: (id: number, status: PurchaseRequestStatus) =>
    apiFetch<PurchaseRequest>(`/purchase-requests/${id}/status`, { method: "PATCH", body: { status } }),

  // Paso 3 del flujo ("Solicitar Cotización"): APPROVED -> IN_QUOTATION.
  requestQuotation: (id: number) =>
    apiFetch<PurchaseRequest>(`/purchase-requests/${id}/request-quotation`, { method: "POST" }),

  // Paso 4 del flujo ("Solicitar Autorización"): IN_QUOTATION -> APPROVE_QUOTE.
  requestQuoteApproval: (id: number) =>
    apiFetch<PurchaseRequest>(`/purchase-requests/${id}/request-quote-approval`, { method: "POST" }),

  // Descarga el PDF de cotizacion (stream binario, no JSON envelope).
  downloadQuoteDocument: (id: number, supplierId?: number) =>
    apiFetchBlob(`/purchase-requests/${id}/quote-document${toQuery({ supplierId })}`),

  listQuoteDocuments: (id: number) =>
    apiFetch<{ files: string[] }>(`/purchase-requests/${id}/quote-documents`),

  // Descarga un archivo puntual ya subido (stream binario, no JSON envelope).
  downloadQuoteDocumentFile: (id: number, filename: string) =>
    apiFetchBlob(`/purchase-requests/${id}/quote-documents/${encodeURIComponent(filename)}`),

  sendQuoteEmail: (id: number, supplierId: number) =>
    apiFetch<{ sent: true }>(`/purchase-requests/${id}/send-quote-email`, {
      method: "POST",
      body: { supplierId },
    }),
};
