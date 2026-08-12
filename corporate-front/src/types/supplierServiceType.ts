// Espejo de corporate-api/src/models/postgres/supplierServiceType.model.ts (SupplierServiceTypeAttributes).
export interface SupplierServiceType {
  id: number;
  code: string;
  name: string;
  description: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierServiceTypeCreateInput {
  code: string;
  name: string;
  description?: string;
}

export interface SupplierServiceTypeUpdateInput {
  name?: string;
  description?: string;
}
