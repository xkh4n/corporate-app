export interface SupplierProductAttributes {
  id: number;
  supplierId: number;
  productId: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SupplierProductCreationAttributes = Pick<SupplierProductAttributes, "supplierId" | "productId"> &
  Partial<Pick<SupplierProductAttributes, "createdBy">>;
