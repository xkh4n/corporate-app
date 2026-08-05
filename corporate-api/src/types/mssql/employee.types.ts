export interface EmployeeAttributes {
  id: number;
  personId: number;
  employeeCode: string;
  costCenterId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type EmployeeCreationAttributes = Pick<EmployeeAttributes, "personId" | "employeeCode" | "costCenterId"> &
  Partial<Pick<EmployeeAttributes, "createdBy" | "updatedBy">>;

export type EmployeeUpdateAttributes = Partial<
  Pick<EmployeeAttributes, "employeeCode" | "costCenterId" | "updatedBy">
>;
