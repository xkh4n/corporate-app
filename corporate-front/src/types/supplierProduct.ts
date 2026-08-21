// Espejo de corporate-api/src/models/postgres/supplierProduct.model.ts (SupplierProductAttributes).
// productId es el ObjectId (24 chars) del producto en Mongo.
import type { Product } from "./product";
import type { Supplier } from "./supplier";

export interface SupplierProduct {
  id: number;
  supplierId: number;
  productId: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

// Espejo de SupplierProductWithProduct (supplierProduct.service.ts): lo que
// devuelve GET /supplier-products?supplierId=X -embebe el producto (cross-engine,
// resuelto a mano en el backend) para poder mostrar su nombre sin un fetch aparte.
export interface SupplierProductWithProduct extends SupplierProduct {
  product: Product | null;
}

// Espejo de SupplierProductWithSupplier: lo que devuelve
// GET /supplier-products?productId=X -misma idea, direccion inversa.
export interface SupplierProductWithSupplier extends SupplierProduct {
  supplier: Supplier | null;
}

export interface SupplierProductCreateInput {
  supplierId: number;
  productId: string;
}
