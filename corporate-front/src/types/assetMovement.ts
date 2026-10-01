// Espejo de corporate-api/src/models/postgres/assetMovement.model.ts (AssetMovementAttributes).
export type AssetMovementType =
  | "ASSIGNED"
  | "REASSIGNED"
  | "SUPPORT"
  | "DECOMMISSIONED"
  | "RETURNED"
  | "DEVALUATED"
  | "MOVE_TO_RETURNED"
  | "SUPPORT_TO_HOLDER"
  | "SUPPORT_TO_STOCK"
  | "WRITTEN_OFF"
  | "RETURNED_TO_SUPPLIER";

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

// Campos del acta de entrega (Fase E enriquecida): solo tienen sentido para
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

// Movimiento de Activos (plan 011). Espejo de corporate-api/src/types/postgres/assetMovement.types.ts.
export interface ReassignAssetInput extends AssetHandoverFields {
  assetId: number;
  userId?: number;
  costCenterId?: number;
  notes?: string;
}

export interface AssignmentCostCenter {
  id: number;
  code: number;
  name: string;
}

export interface CurrentAssignment {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  statusCode: string;
  statusName: string;
  movementId: number;
  movementType: AssetMovementType;
  movementDate: string;
  holder: { userId: number; fullName: string };
  costCenter: AssignmentCostCenter | null;
  handover: {
    supervisorName: string | null;
    macAddress: string | null;
    storageCapacity: string | null;
    ramCapacity: string | null;
    hasBag: boolean | null;
    hasLock: boolean | null;
    hasCharger: boolean | null;
  };
}

export interface AssignmentFilters {
  costCenterId?: number;
  categoryId?: string;
  user?: string;
  serial?: string;
}

export interface AssignmentRow {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  statusCode: string;
  statusName: string;
  productName: string | null;
  categoryName: string | null;
  holder: { userId: number; fullName: string } | null;
  costCenter: AssignmentCostCenter | null;
  movementId: number | null;
  assignedAt: string | null;
}

// Dar de baja (plan 012).
export type DecommissionReason = "OBSOLESCENCE" | "IRREPARABLE_DAMAGE" | "THEFT_LOSS" | "OTHER";

// Va como multipart: la foto del activo es obligatoria (plan 013).
export interface DecommissionAssetInput {
  assetId: number;
  reason: DecommissionReason;
  detail?: string;
  photo: File;
}

// Devolucion al proveedor de un arriendo o servicio (plan 018). Multipart, foto opcional.
export type SupplierReturnReason = "END_OF_CONTRACT" | "FAILURE" | "REPLACEMENT" | "OTHER";

export interface ReturnToSupplierInput {
  assetId: number;
  reason: SupplierReturnReason;
  detail?: string;
  // YYYY-MM-DD
  paymentExitDate: string;
  supplierDocument?: string;
  photo?: File;
}

// flow (plan 018): ACCOUNTING = tag ACT (baja que sigue a Baja Contable); SUPPLIER_RETURN = arriendo o
// servicio, se devuelve a su proveedor sin proceso contable.
export interface DecommissionCheck {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  flow: "ACCOUNTING" | "SUPPLIER_RETURN";
  statusCode: string;
  statusName: string;
  costCenter: AssignmentCostCenter | null;
  classified: boolean;
  classification: string | null;
  openTicketNumber: string | null;
  eligible: boolean;
  blockReason: string | null;
}
