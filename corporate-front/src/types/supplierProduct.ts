// Espejo de corporate-api/src/models/postgres/supplierProduct.model.ts (SupplierProductAttributes).
// productId es el ObjectId (24 chars) del producto en Mongo.
export interface SupplierProduct {
  id: number;
  supplierId: number;
  productId: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierProductCreateInput {
  supplierId: number;
  productId: string;
}
