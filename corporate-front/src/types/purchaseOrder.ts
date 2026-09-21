import type { Quote } from "./quote";

// Espejo de corporate-api/src/models/mssql/purchaseOrder.model.ts (PurchaseOrderAttributes).
export interface PurchaseOrder {
  id: number;
  orderNumber: string;
  requestId: number;
  issuedAt: string;
  paymentTerms: string | null;
  supplierId: number;
  sentAt: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  // Una OC cubre N cotizaciones ganadoras (mismo proveedor, misma
  // solicitud). Viene embebida en el listado (GET /purchase-orders), no en
  // GET /purchase-orders/:id -ver listPurchaseOrders en el backend.
  quotes?: Quote[];
}

export interface PurchaseOrderCreateInput {
  quoteIds: number[];
  paymentTerms?: string;
}
