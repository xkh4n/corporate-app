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
  supervisorName: string | null;
  macAddress: string | null;
  storageCapacity: string | null;
  ramCapacity: string | null;
  hasBag: boolean | null;
  hasLock: boolean | null;
  hasCharger: boolean | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  movementUsers: AssetMovementUser[];
}

export type AssetStorageCapacity = "512 GB" | "1 TB";
export type AssetRamCapacity = "8 GB" | "16 GB" | "32 GB";

// Campos del acta de entrega (Fase E enriquecida, set portado del
// formulario de asignacion de AntherxSoft): solo tienen sentido para
// ASSIGNED/REASSIGNED, todos opcionales -las asignaciones sin estos datos
// siguen funcionando igual que antes.
export interface AssetHandoverFields {
  supervisorName?: string;
  macAddress?: string;
  storageCapacity?: AssetStorageCapacity;
  ramCapacity?: AssetRamCapacity;
  hasBag?: boolean;
  hasLock?: boolean;
  hasCharger?: boolean;
}

// userIds es requerido (array no vacio) cuando movementType es "ASSIGNED" o "REASSIGNED" -lo valida el backend.
export interface AssetMovementCreateInput extends AssetHandoverFields {
  assetId: number;
  movementType: AssetMovementType;
  userIds?: number[];
  notes?: string;
}

// Paso 9: asignar UNA unidad a UN empleado (userId singular, no userIds[]).
export interface AssignAssetInput extends AssetHandoverFields {
  assetId: number;
  userId: number;
  notes?: string;
}
