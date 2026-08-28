export interface CustomerAttributes {
  id: number;
  businessPartnerId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CustomerCreationAttributes = Pick<CustomerAttributes, "businessPartnerId"> &
  Partial<Pick<CustomerAttributes, "createdBy" | "updatedBy">>;
