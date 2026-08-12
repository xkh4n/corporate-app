// Espejo de corporate-api/src/models/mongo/product.model.ts (ProductAttributes).
// Excepcion Mongo: id y categoryId son ObjectId de 24 caracteres (string), no number.
export type ProductType = "ARRIENDO" | "SERVICIO" | "COMPRA";

export interface Product {
  id: string;
  name: string;
  description: string | null;
  productType: ProductType;
  categoryId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductCreateInput {
  name: string;
  description?: string;
  productType: ProductType;
  categoryId?: string;
}

export interface ProductUpdateInput {
  name?: string;
  description?: string;
  productType?: ProductType;
  categoryId?: string;
}
