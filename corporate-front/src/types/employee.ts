// Espejo de corporate-api/src/models/postgres/employee.model.ts (EmployeeAttributes).
import type { Person } from "./person";

export interface Employee {
  id: number;
  personId: number;
  employeeCode: string;
  costCenterId: number;
  // ObjectId de Mongo (coleccion positions), null solo en colaboradores
  // creados antes de que existiera el cargo.
  positionId: string | null;
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
  positionId: string;
}

export interface EmployeeUpdateInput {
  employeeCode?: string;
  costCenterId?: number;
  positionId?: string;
}
