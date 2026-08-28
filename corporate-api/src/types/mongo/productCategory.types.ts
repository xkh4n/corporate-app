export interface ProductCategoryAttributes {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductCategoryCreationAttributes = Pick<ProductCategoryAttributes, "name"> &
  Partial<Pick<ProductCategoryAttributes, "description">>;

export type ProductCategoryUpdateAttributes = Partial<Pick<ProductCategoryAttributes, "name" | "description">>;
