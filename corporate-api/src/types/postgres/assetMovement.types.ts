import type { AssetMovementType } from "../../models/postgres/assetMovement.model";

export interface AssetMovementAttributes {
  id: number;
  assetId: number;
  movementType: AssetMovementType;
  movementDate: Date;
  notes: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// userIds: un movimiento puede involucrar 1 o mas usuarios (N:M, razon
// explicita del usuario para sacar Asignacion de MSSQL). Requerido para
// ASSIGNED/REASSIGNED (no tiene sentido "asignar" sin decir a quien),
// opcional para SUPPORT/DECOMMISSIONED. Ver services/postgres/assetMovement.service.ts.
export interface CreateAssetMovementInput {
  assetId: number;
  movementType: AssetMovementType;
  userIds?: number[];
  notes?: string | null;
  createdBy?: number | null;
}
