// Espejo de corporate-api/src/models/mongo/productCategory.model.ts (ProductCategoryAttributes).
// Excepcion Mongo: id es ObjectId de 24 caracteres (string), no number.
export interface ProductCategory {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductCategoryCreateInput {
  name: string;
  description?: string;
}

export interface ProductCategoryUpdateInput {
  name?: string;
  description?: string;
}
