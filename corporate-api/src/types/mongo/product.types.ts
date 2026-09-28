export type ProductType = "ARRIENDO" | "SERVICIO" | "COMPRA";

export interface ProductAttributes {
  id: string;
  name: string;
  description: string | null;
  productType: ProductType;
  categoryId: string | null;
  brand: string | null;
  productModel: string | null;
  image: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductCreationAttributes = Pick<ProductAttributes, "name" | "productType"> &
  Partial<Pick<ProductAttributes, "description" | "categoryId" | "brand" | "productModel" | "isActive">>;

export type ProductUpdateAttributes = Partial<
  Pick<ProductAttributes, "name" | "description" | "productType" | "categoryId" | "brand" | "productModel" | "isActive">
>;
