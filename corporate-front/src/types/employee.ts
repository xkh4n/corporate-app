// Espejo de corporate-api/src/models/postgres/employee.model.ts (EmployeeAttributes).
import type { Person } from "./person";

export interface Employee {
  id: number;
  personId: number;
  employeeCode: string;
  costCenterId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  person: Person;
}

export interface EmployeeCreateInput {
  personId: number;
  employeeCode: string;
  costCenterId: number;
}

export interface EmployeeUpdateInput {
  employeeCode?: string;
  costCenterId?: number;
}
