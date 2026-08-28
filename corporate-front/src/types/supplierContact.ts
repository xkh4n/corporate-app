// Espejo de corporate-api/src/models/postgres/supplierContact.model.ts (SupplierContactAttributes).
export interface SupplierContact {
  id: number;
  supplierId: number;
  name: string;
  email: string;
  phone: string | null;
  position: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierContactCreateInput {
  supplierId: number;
  name: string;
  email: string;
  phone?: string;
  position?: string;
}

export interface SupplierContactUpdateInput {
  name?: string;
  email?: string;
  phone?: string;
  position?: string;
}
