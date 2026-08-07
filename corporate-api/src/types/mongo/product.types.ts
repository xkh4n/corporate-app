export type ProductType = "ARRIENDO" | "SERVICIO" | "COMPRA";

export interface ProductAttributes {
  id: string;
  name: string;
  description: string | null;
  productType: ProductType;
  categoryId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductCreationAttributes = Pick<ProductAttributes, "name" | "productType"> &
  Partial<Pick<ProductAttributes, "description" | "categoryId" | "isActive">>;

export type ProductUpdateAttributes = Partial<
  Pick<ProductAttributes, "name" | "description" | "productType" | "categoryId" | "isActive">
>;
