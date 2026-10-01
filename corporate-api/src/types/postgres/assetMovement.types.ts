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

// Campos del acta de entrega (Fase E enriquecida): solo tienen sentido en
// ASSIGNED/REASSIGNED,
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

// Reasignar (plan 011): a otro usuario, a otro centro de costo o ambos. Lo que
// no viene se mantiene; si nada cambia es un 400. Lleva los datos del acta
// porque genera un acta nueva.
export interface ReassignAssetInput extends AssetHandoverInput {
  assetId: number;
  userId?: number;
  costCenterId?: number;
  notes?: string | null;
  createdBy?: number | null;
}

export interface AssignmentCostCenter {
  id: number;
  code: number;
  name: string;
}

// Asignacion vigente de un activo: el tenedor (ultimo movimiento con usuario) y
// el movimiento que genero su acta (el ultimo ASSIGNED/REASSIGNED/DEVALUATED;
// una salida de soporte al mismo tenedor no genera acta nueva).
export interface CurrentAssignment {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  statusCode: string;
  statusName: string;
  movementId: number;
  movementType: AssetMovementType;
  movementDate: Date;
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
  // Nombre o RUT del tenedor.
  user?: string;
  // Tag o numero de serie.
  serial?: string;
}

// Fila de Visualizar Asignaciones / Formulario Asignacion. Solo el nombre del
// tenedor: ni RUT ni correo.
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
  assignedAt: Date | null;
}

// Dar de baja (plan 012). Motivo de una lista; el detalle es obligatorio con OTHER.
export type DecommissionReason = "OBSOLESCENCE" | "IRREPARABLE_DAMAGE" | "THEFT_LOSS" | "OTHER";

// Foto del activo al darlo de baja (plan 013): obligatoria, JPEG o PNG ya validado por uploadSingle.
export interface DecommissionPhotoFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface DecommissionAssetInput {
  assetId: number;
  reason: DecommissionReason;
  detail?: string | null;
  photo: DecommissionPhotoFile;
  createdBy?: number | null;
}

// Devolucion al proveedor de un arriendo o servicio (plan 018). La foto es opcional.
export type SupplierReturnReason = "END_OF_CONTRACT" | "FAILURE" | "REPLACEMENT" | "OTHER";

export interface ReturnToSupplierInput {
  assetId: number;
  reason: SupplierReturnReason;
  detail?: string | null;
  // YYYY-MM-DD: desde cuando el proveedor deja de cobrarlo.
  paymentExitDate: string;
  // N° de guia o acta de retiro del proveedor.
  supplierDocument?: string | null;
  photo?: DecommissionPhotoFile;
  createdBy?: number | null;
}

// Lo que la pantalla necesita para decidir si se puede dar de baja y por que no.
// flow (plan 018): ACCOUNTING = tag ACT, baja operativa que sigue a Baja Contable;
// SUPPLIER_RETURN = arriendo/servicio, se devuelve al proveedor sin proceso contable.
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
