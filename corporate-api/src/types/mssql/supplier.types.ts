export interface SupplierAttributes {
  id: number;
  businessPartnerId: number;
  serviceTypeId: number;
  paymentTermDays: number;
  deliveryTermsId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SupplierCreationAttributes = Pick<
  SupplierAttributes,
  "businessPartnerId" | "serviceTypeId" | "deliveryTermsId"
> &
  Partial<Pick<SupplierAttributes, "paymentTermDays" | "createdBy" | "updatedBy">>;

export type SupplierUpdateAttributes = Partial<
  Pick<SupplierAttributes, "serviceTypeId" | "paymentTermDays" | "deliveryTermsId" | "updatedBy">
>;
