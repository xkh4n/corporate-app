// Espejo de corporate-api/src/models/postgres/costCenter.model.ts (CostCenterAttributes).
export interface CostCenter {
  id: number;
  code: number;
  name: string;
  description: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CostCenterCreateInput {
  code: number;
  name: string;
  description?: string;
}

// code es inmutable una vez creado: no viaja en el body de update.
export interface CostCenterUpdateInput {
  name?: string;
  description?: string;
}
