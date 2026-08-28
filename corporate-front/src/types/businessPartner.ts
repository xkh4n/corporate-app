// Espejo de corporate-api/src/models/postgres/businessPartner.model.ts (BusinessPartnerAttributes).
export interface BusinessPartner {
  id: number;
  legalName: string;
  nationalId: string;
  businessLine: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessPartnerCreateInput {
  legalName: string;
  nationalId: string;
  businessLine?: string;
}

export type BusinessPartnerUpdateInput = Partial<BusinessPartnerCreateInput>;
