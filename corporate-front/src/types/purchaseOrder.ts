import type { Quote } from "./quote";

// Espejo de corporate-api/src/models/postgres/purchaseOrder.model.ts (PurchaseOrderAttributes).
export interface PurchaseOrder {
  id: number;
  orderNumber: string;
  quoteId: number;
  issuedAt: string;
  paymentTerms: string | null;
  supplierId: number;
  sentAt: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  // Solo viene embebida cuando se lista con el filtro requestId (ver
  // purchaseOrderService.list -el backend solo agrega el include de Quote en
  // ese caso, ver listPurchaseOrders en purchaseOrder.service.ts).
  quote?: Quote;
}

export interface PurchaseOrderCreateInput {
  quoteId: number;
  paymentTerms?: string;
}
