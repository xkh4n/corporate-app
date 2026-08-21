export interface EmployeeAttributes {
  id: number;
  personId: number;
  employeeCode: string;
  costCenterId: number;
  // ObjectId de Mongo (coleccion positions), null solo en colaboradores
  // creados antes de que existiera el cargo -ver employee.model.ts.
  positionId: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type EmployeeCreationAttributes = Pick<
  EmployeeAttributes,
  "personId" | "employeeCode" | "costCenterId" | "positionId"
> &
  Partial<Pick<EmployeeAttributes, "createdBy" | "updatedBy">>;

export type EmployeeUpdateAttributes = Partial<
  Pick<EmployeeAttributes, "employeeCode" | "costCenterId" | "positionId" | "updatedBy">
>;
