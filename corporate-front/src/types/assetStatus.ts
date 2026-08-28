// Espejo de corporate-api/src/models/postgres/assetStatus.model.ts (AssetStatusAttributes).
export interface AssetStatus {
  id: number;
  code: string;
  name: string;
  description: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetStatusCreateInput {
  code: string;
  name: string;
  description?: string;
}

// code es inmutable una vez creado: no viaja en el body de update.
export interface AssetStatusUpdateInput {
  name?: string;
  description?: string;
}
