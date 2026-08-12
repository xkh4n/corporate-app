// Espejo de corporate-api/src/models/postgres/purchaseOrder.model.ts (PurchaseOrderAttributes).
export interface PurchaseOrder {
  id: number;
  orderNumber: string;
  quoteId: number;
  issuedAt: string;
  paymentTerms: string | null;
  supplierId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderCreateInput {
  quoteId: number;
  paymentTerms?: string;
}
