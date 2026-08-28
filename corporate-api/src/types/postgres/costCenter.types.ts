export interface CostCenterAttributes {
  id: number;
  code: number;
  name: string;
  description: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CostCenterCreationAttributes = Pick<CostCenterAttributes, "code" | "name"> &
  Partial<Pick<CostCenterAttributes, "description" | "createdBy" | "updatedBy">>;

export type CostCenterUpdateAttributes = Partial<
  Pick<CostCenterAttributes, "code" | "name" | "description" | "updatedBy">
>;
