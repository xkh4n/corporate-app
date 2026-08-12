// Espejo de corporate-api/src/models/postgres/supplierDeliveryTerms.model.ts (SupplierDeliveryTermsAttributes).
export interface SupplierDeliveryTerms {
  id: number;
  code: string;
  name: string;
  description: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierDeliveryTermsCreateInput {
  code: string;
  name: string;
  description?: string;
}

export interface SupplierDeliveryTermsUpdateInput {
  name?: string;
  description?: string;
}
