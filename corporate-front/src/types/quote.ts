// Espejo de corporate-api/src/models/postgres/quote.model.ts (QuoteAttributes).
// productId es el ObjectId (24 chars) del producto en Mongo. purchaseValue es decimal, viaja como string.
export interface Quote {
  id: number;
  quoteNumber: string;
  requestId: number;
  productId: string;
  supplierId: number;
  purchaseValue: string;
  purchaseUnit: string | null;
  storageUnit: string | null;
  productCode: string | null;
  model: string | null;
  status: "PENDING" | "SELECTED" | "REJECTED";
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteCreateInput {
  requestId: number;
  productId: string;
  supplierId: number;
  purchaseValue: number;
  purchaseUnit?: string;
  storageUnit?: string;
  productCode?: string;
  model?: string;
}
