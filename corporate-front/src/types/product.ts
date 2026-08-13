// Espejo de corporate-api/src/models/mongo/product.model.ts (ProductAttributes).
// Excepcion Mongo: id y categoryId son ObjectId de 24 caracteres (string), no number.
export type ProductType = "ARRIENDO" | "SERVICIO" | "COMPRA";

export interface Product {
  id: string;
  name: string;
  description: string | null;
  productType: ProductType;
  categoryId: string | null;
  // Path relativo ("uploads/images/products/<id>.jpg") o null hasta la
  // primera subida -ver productService.uploadImage/imageUrl. Nunca se manda
  // en create/update, solo lo setea el backend via POST /products/:id/image.
  image: string | null;
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
