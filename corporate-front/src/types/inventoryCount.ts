// Espejo de corporate-api/src/models/postgres/inventoryCount*.model.ts y
// corporate-api/src/types/postgres/inventoryCount.types.ts.
import type { Asset } from "./asset";

export type InventoryCountStatus = "OPEN" | "CLOSED";

// Estados que declara el auditor. DAMAGED solo existe en la toma y en
// asset_statuses; "mantencion" es SUPPORT y "baja" es DECOMMISSIONED.
export type InventoryLineStatusCode = "ASSIGNED" | "SUPPORT" | "AVAILABLE" | "DAMAGED" | "DECOMMISSIONED";

// Que CAMBIO la toma en un activo que ya existia (antes -> despues). Un activo
// creado por la toma no tiene cambios.
export type InventoryChange = "STATUS_CHANGED" | "HOLDER_CHANGED" | "COST_CENTER_CHANGED";

// Como se identifica el equipo que el auditor tiene en la mano.
export type InventoryLookupBy = "TAG" | "SERIAL";

export interface InventoryCount {
  id: number;
  number: string;
  name: string;
  notes: string | null;
  status: InventoryCountStatus;
  startedAt: string;
  closedAt: string | null;
  createdBy: number | null;
  closedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

// GET /inventory-counts/:id agrega los totales baratos de la cabecera.
export interface InventoryCountDetail extends InventoryCount {
  totalLines: number;
  createdAssets: number;
}

// POST /inventory-counts/start: resumed = el auditor ya tenia una abierta.
export interface InventoryCountStarted extends InventoryCount {
  resumed: boolean;
}

// POST /inventory-counts/:id/close: ids de los activos creados por la toma.
export interface InventoryCountClosed extends InventoryCount {
  createdAssetIds: number[];
}

// POST /inventory-counts/holders/lookup: usuario activo con ese RUT exacto (solo id y nombre).
export interface InventoryHolder {
  userId: number;
  fullName: string;
}

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
  createdAt: string;
}

export interface InventoryReportMissingAsset {
  assetId: number;
  tag: string;
  productName: string | null;
  serialNumber: string | null;
  systemStatusCode: string;
  systemHolder: InventoryUserLabel | null;
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

export interface InventoryCountReport {
  count: InventoryCount;
  auditor: InventoryUserLabel | null;
  summary: InventoryCountSummary;
  lines: InventoryReportLine[];
  missingAssets: InventoryReportMissingAsset[];
}

// GET /inventory-counts/:id/lookup?by=&value=: null si el equipo no existe (se generara una etiqueta nueva).
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
  // Estados que la toma acepta para este activo.
  allowedStatusCodes: InventoryLineStatusCode[];
  // Estado que la toma impone sin importar lo declarado (devolucion -> SOPORTE).
  forcedStatusCode: InventoryLineStatusCode | null;
  // Aviso para el auditor (devolucion, baja).
  instruction: string | null;
}

// Respuesta de POST .../lines: la fila guardada, con el activo (tag) incluido.
export interface InventoryLineRecord {
  id: number;
  assetId: number;
  assetCreated: boolean;
  statusCode: InventoryLineStatusCode;
  serialNumber: string | null;
  asset?: Asset;
}

// lookupBy TAG: tag obligatorio (si no existe se crea un activo con tag generado y
// la serie es obligatoria). lookupBy SERIAL: serialNumber obligatorio; si ya
// existe se vincula, si no se da de alta con esa serie.
export interface InventoryLineInput {
  lookupBy: InventoryLookupBy;
  tag?: string | null;
  productCategoryId: string;
  productId: string;
  description?: string | null;
  costCenterId: number;
  serialNumber?: string | null;
  holderUserId?: number | null;
  statusCode: InventoryLineStatusCode;
}

// Solo la descripcion: el resto ya quedo escrito en el activo real.
export interface InventoryLineUpdateInput {
  description?: string | null;
}
