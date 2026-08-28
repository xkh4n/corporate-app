// Espejo de corporate-api/src/models/postgres/customer.model.ts (CustomerAttributes).
import type { BusinessPartner } from "./businessPartner";

export interface Customer {
  id: number;
  businessPartnerId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  businessPartner: BusinessPartner;
}

export interface CustomerCreateInput {
  businessPartnerId: number;
}
