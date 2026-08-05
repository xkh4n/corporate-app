export type ProductType = "LEASE" | "SERVICE" | "PURCHASE";

export interface ProductAttributes {
  id: string;
  name: string;
  description: string | null;
  productType: ProductType;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductCreationAttributes = Pick<ProductAttributes, "name" | "productType"> &
  Partial<Pick<ProductAttributes, "description" | "isActive">>;

export type ProductUpdateAttributes = Partial<
  Pick<ProductAttributes, "name" | "description" | "productType" | "isActive">
>;
