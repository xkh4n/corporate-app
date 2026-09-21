import type { InventoryLineStatusCode } from "../../models/postgres/inventoryCountLine.model";

// Que CAMBIO la toma en un activo que ya existia (contra el snapshot del
// sistema al capturar la linea). Una linea con assetCreated no tiene cambios.
export type InventoryChange = "STATUS_CHANGED" | "HOLDER_CHANGED" | "COST_CENTER_CHANGED";

// Campos de una linea que alcanzan para calcular sus cambios (ver
// library/inventoryCountChanges.ts).
export interface InventoryLineComparable {
  assetCreated: boolean;
  // Estado con el que quedo el activo tras la toma.
  resultingStatusCode: string | null;
  holderUserId: number | null;
  costCenterId: number | null;
  systemStatusCode: string | null;
  systemHolderUserId: number | null;
  systemCostCenterId: number | null;
}

export interface StartInventoryCountInput {
  name?: string | null;
  notes?: string | null;
  createdBy: number;
}

// Como se identifica el equipo que el auditor tiene en la mano.
export type InventoryLookupBy = "TAG" | "SERIAL";

// lookupBy TAG: tag obligatorio. Si existe la linea se VINCULA a ese activo
// (se toma su serie); si no existe se CREA un activo con un tag generado por el
// sistema (el texto ingresado se descarta) y serialNumber es obligatorio.
// lookupBy SERIAL: serialNumber obligatorio y sirve para encontrar el activo
// (si ya existe se vincula, con su tag); si no existe se crea con esa serie.
// Ver addInventoryLine.
export interface AddInventoryLineInput {
  lookupBy: InventoryLookupBy;
  tag?: string | null;
  productCategoryId: string;
  productId: string;
  description?: string | null;
  costCenterId: number;
  serialNumber?: string | null;
  holderUserId?: number | null;
  statusCode: InventoryLineStatusCode;
  createdBy: number;
}

// Quien ejecuta la accion. isAdmin viene del rol del JWT/sesion (nunca del cuerpo).
export interface InventoryCountActor {
  userId: number;
  isAdmin: boolean;
}

// Solo la descripcion: el estado/tenedor/serie/centro de costo ya quedaron
// escritos en el activo real y cambiarlos aqui los desincronizaria (corregirlos
// es un movimiento normal del activo).
export interface UpdateInventoryLineInput {
  description?: string | null;
}

export interface InventoryCountSummary {
  totalLines: number;
  linkedLines: number;
  createdAssets: number;
  // Lineas en las que la toma cambio estado, usuario o centro de costo de un activo existente.
  withChanges: number;
  // null mientras la toma esta OPEN: los faltantes solo se fijan al cerrar.
  missingAssets: number | null;
}

// Colaborador resuelto en LECTURA desde MSSQL (no se copia PII a Postgres).
export interface InventoryUserLabel {
  userId: number;
  fullName: string;
  documentId: string;
}

export interface InventoryReportLine {
  id: number;
  assetId: number;
  tag: string;
  assetCreated: boolean;
  categoryName: string | null;
  productName: string | null;
  description: string | null;
  costCenter: { id: number; code: number; name: string } | null;
  serialNumber: string | null;
  holder: InventoryUserLabel | null;
  // Estado con el que quedo el activo tras la toma.
  statusCode: string;
  systemStatusCode: string | null;
  systemHolder: InventoryUserLabel | null;
  systemCostCenter: { id: number; code: number; name: string } | null;
  changes: InventoryChange[];
  // El sistema lo tenia en devolucion: quedo en Soporte y debe enviarse a Soporte TI / Adquisiciones TI.
  supportFollowUp: boolean;
  // Se puede quitar de la toma solo si no creo ni modifico el activo.
  removable: boolean;
  createdAt: Date;
}

export interface InventoryReportMissingAsset {
  assetId: number;
  tag: string;
  productName: string | null;
  serialNumber: string | null;
  systemStatusCode: string;
  systemHolder: InventoryUserLabel | null;
}

// Resultado orientativo de validar un TAG o una serie en la pantalla de
// captura: sirve para precargar el formulario. addInventoryLine vuelve a
// validar todo del lado del servidor (el activo pudo cambiar entre la
// validacion y el guardado).
export interface InventoryLookup {
  assetId: number;
  tag: string;
  statusCode: string | null;
  statusName: string | null;
  serialNumber: string | null;
  costCenterId: number | null;
  productId: string | null;
  productCategoryId: string | null;
  holder: InventoryUserLabel | null;
  alreadyInCount: boolean;
  // Estados que el auditor puede elegir para este activo (lo que la toma acepta).
  allowedStatusCodes: InventoryLineStatusCode[];
  // Estado que la toma impone sin importar lo declarado (devolucion -> SOPORTE).
  forcedStatusCode: InventoryLineStatusCode | null;
  // Aviso para el auditor (devolucion, baja).
  instruction: string | null;
}
