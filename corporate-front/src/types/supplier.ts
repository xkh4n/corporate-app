// Espejo de corporate-api/src/models/postgres/supplier.model.ts (SupplierAttributes).
import type { BusinessPartner } from "./businessPartner";
import type { SupplierServiceType } from "./supplierServiceType";
import type { SupplierDeliveryTerms } from "./supplierDeliveryTerms";

export interface Supplier {
  id: number;
  businessPartnerId: number;
  serviceTypeId: number;
  paymentTermDays: number | null;
  deliveryTermsId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  businessPartner: BusinessPartner;
  serviceType: SupplierServiceType;
  deliveryTerms: SupplierDeliveryTerms;
}

export interface SupplierCreateInput {
  businessPartnerId: number;
  serviceTypeId: number;
  paymentTermDays?: number;
  deliveryTermsId: number;
}

export interface SupplierUpdateInput {
  serviceTypeId?: number;
  paymentTermDays?: number;
  deliveryTermsId?: number;
}
