import type { SupplierServiceType, SupplierDeliveryTerms } from "../../models/mssql/supplier.model";

export interface SupplierAttributes {
  id: number;
  businessPartnerId: number;
  serviceType: SupplierServiceType;
  paymentTermDays: number;
  deliveryTerms: SupplierDeliveryTerms;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SupplierCreationAttributes = Pick<
  SupplierAttributes,
  "businessPartnerId" | "serviceType" | "deliveryTerms"
> &
  Partial<Pick<SupplierAttributes, "paymentTermDays" | "createdBy" | "updatedBy">>;

export type SupplierUpdateAttributes = Partial<
  Pick<SupplierAttributes, "serviceType" | "paymentTermDays" | "deliveryTerms" | "updatedBy">
>;
