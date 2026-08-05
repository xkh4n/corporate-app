export interface PurchaseOrderAttributes {
  id: number;
  orderNumber: string;
  quoteId: number;
  issuedAt: Date;
  paymentTerms: string | null;
  supplierId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// orderNumber (OC000000001...) y supplierId (copiado de la Quote) no son
// input del cliente. paymentTerms, si no se entrega, se completa desde
// Supplier.paymentTermDays (ver services/mssql/purchaseOrder.service.ts).
export type PurchaseOrderCreationAttributes = Pick<PurchaseOrderAttributes, "quoteId"> &
  Partial<Pick<PurchaseOrderAttributes, "paymentTerms" | "createdBy" | "updatedBy">>;
