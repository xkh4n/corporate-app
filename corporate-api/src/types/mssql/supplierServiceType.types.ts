export interface SupplierServiceTypeAttributes {
  id: number;
  code: string;
  name: string;
  description: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SupplierServiceTypeCreationAttributes = Pick<SupplierServiceTypeAttributes, "code" | "name"> &
  Partial<Pick<SupplierServiceTypeAttributes, "description" | "createdBy" | "updatedBy">>;

export type SupplierServiceTypeUpdateAttributes = Partial<
  Pick<SupplierServiceTypeAttributes, "name" | "description" | "updatedBy">
>;
