// Espejo de corporate-api/src/models/postgres/assetMovement.model.ts (AssetMovementAttributes).
export type AssetMovementType = "ASSIGNED" | "REASSIGNED" | "SUPPORT" | "DECOMMISSIONED";

export interface AssetMovementUser {
  id: number;
  assetMovementId: number;
  userId: number;
}

export interface AssetMovement {
  id: number;
  assetId: number;
  movementType: AssetMovementType;
  movementDate: string;
  notes: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  movementUsers: AssetMovementUser[];
}

// userIds es requerido (array no vacio) cuando movementType es "ASSIGNED" o "REASSIGNED" -lo valida el backend.
export interface AssetMovementCreateInput {
  assetId: number;
  movementType: AssetMovementType;
  userIds?: number[];
  notes?: string;
}

// Paso 9: asignar UNA unidad a UN empleado (userId singular, no userIds[]).
export interface AssignAssetInput {
  assetId: number;
  userId: number;
  notes?: string;
}
