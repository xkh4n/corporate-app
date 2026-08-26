import type { AssetMovementType } from "../../models/postgres/assetMovement.model";

export interface AssetMovementAttributes {
  id: number;
  assetId: number;
  movementType: AssetMovementType;
  movementDate: Date;
  notes: string | null;
  supervisorName: string | null;
  macAddress: string | null;
  storageCapacity: string | null;
  ramCapacity: string | null;
  hasBag: boolean | null;
  hasLock: boolean | null;
  hasCharger: boolean | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// Campos del acta de entrega (Fase E enriquecida, set portado del
// formulario de AntherxSoft): solo tienen sentido en ASSIGNED/REASSIGNED,
// pero se aceptan de forma generica en CreateAssetMovementInput -mismo
// criterio que "notes", que tampoco esta restringido por movementType a
// nivel de tipos.
export interface AssetHandoverInput {
  supervisorName?: string | null;
  macAddress?: string | null;
  storageCapacity?: string | null;
  ramCapacity?: string | null;
  hasBag?: boolean | null;
  hasLock?: boolean | null;
  hasCharger?: boolean | null;
}

// userIds: un movimiento puede involucrar 1 o mas usuarios (N:M, razon
// explicita del usuario para sacar Asignacion de MSSQL). Requerido para
// ASSIGNED/REASSIGNED (no tiene sentido "asignar" sin decir a quien),
// opcional para SUPPORT/DECOMMISSIONED. Ver services/postgres/assetMovement.service.ts.
export interface CreateAssetMovementInput extends AssetHandoverInput {
  assetId: number;
  movementType: AssetMovementType;
  userIds?: number[];
  notes?: string | null;
  createdBy?: number | null;
}

// Paso 9 del flujo: asignar UNA unidad a UN empleado -userId singular (no
// userIds[] como el movimiento generico) porque assignAssetToUser modela
// especificamente esa accion; por debajo llama a createAssetMovement con
// userIds:[userId]. Ver services/postgres/assetMovement.service.ts.
export interface AssignAssetInput extends AssetHandoverInput {
  assetId: number;
  userId: number;
  notes?: string | null;
  createdBy?: number | null;
}
