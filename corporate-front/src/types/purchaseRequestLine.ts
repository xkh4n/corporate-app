// Espejo de corporate-api/src/models/postgres/purchaseRequestLine.model.ts (PurchaseRequestLineAttributes).
// productId es el ObjectId (24 chars) del producto en Mongo.
export interface PurchaseRequestLine {
  id: number;
  requestId: number;
  equipmentType: string | null;
  productId: string;
  supplierId: number | null;
  quantity: number;
  status: string;
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
  status?: string;
}
