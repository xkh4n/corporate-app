export interface BusinessPartnerAttributes {
  id: number;
  legalName: string;
  nationalId: string;
  businessLine: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type BusinessPartnerCreationAttributes = Pick<BusinessPartnerAttributes, "legalName" | "nationalId"> &
  Partial<Pick<BusinessPartnerAttributes, "businessLine" | "createdBy" | "updatedBy">>;

export type BusinessPartnerUpdateAttributes = Partial<
  Pick<BusinessPartnerAttributes, "legalName" | "nationalId" | "businessLine" | "updatedBy">
>;
