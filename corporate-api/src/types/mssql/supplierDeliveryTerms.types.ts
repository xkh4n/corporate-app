export interface SupplierDeliveryTermsAttributes {
  id: number;
  code: string;
  name: string;
  description: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SupplierDeliveryTermsCreationAttributes = Pick<SupplierDeliveryTermsAttributes, "code" | "name"> &
  Partial<Pick<SupplierDeliveryTermsAttributes, "description" | "createdBy" | "updatedBy">>;

export type SupplierDeliveryTermsUpdateAttributes = Partial<
  Pick<SupplierDeliveryTermsAttributes, "name" | "description" | "updatedBy">
>;
