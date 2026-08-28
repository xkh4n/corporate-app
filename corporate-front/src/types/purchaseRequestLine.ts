// Espejo de corporate-api/src/library/purchaseRequestStatus.ts (PURCHASE_REQUEST_LINE_STATUSES).
export type PurchaseRequestLineStatus = "PENDING" | "APPROVED" | "REJECTED";

// Espejo de corporate-api/src/models/postgres/purchaseRequestLine.model.ts (PurchaseRequestLineAttributes).
// productId es el ObjectId (24 chars) del producto en Mongo.
export interface PurchaseRequestLine {
  id: number;
  requestId: number;
  equipmentType: string | null;
  productId: string;
  supplierId: number | null;
  quantity: number;
  status: PurchaseRequestLineStatus;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseRequestLineCreateInput {
  requestId: number;
  productId: string;
  quantity: number;
  equipmentType?: string;
  supplierId?: number;
}

export interface PurchaseRequestLineUpdateInput {
  equipmentType?: string;
  supplierId?: number;
  quantity?: number;
  status?: PurchaseRequestLineStatus;
}
