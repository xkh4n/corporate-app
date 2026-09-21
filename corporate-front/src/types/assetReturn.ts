// Solo id y nombre: las respuestas de devoluciones no incluyen el RUT.
export interface AssetReturnUserLabel {
  userId: number;
  fullName: string;
}

// Espejo de corporate-api/src/types/postgres/assetReturn.types.ts y
// models/postgres/assetReturn.model.ts. Ver .claude/planes/004-devolucion-de-activos.html.

// DRAFT (se arma y se adjunta la guia) -> SENT (activos MOVE_TO_RETURNED) ->
// RECEIVED (Adquisiciones recibio todos). "Recibida parcialmente" es SENT con
// receivedCount > 0. CANCELLED solo desde DRAFT.
export type AssetReturnStatus = "DRAFT" | "SENT" | "RECEIVED" | "CANCELLED";

// OWN ("mis equipos"): equipos asignados al propio solicitante; el centro de costo lo define el activo y no se
// elige. OTHERS: equipos de otro usuario; el solicitante elige el centro de costo. Una devolucion no mezcla ambos.
export type AssetReturnScope = "OWN" | "OTHERS";

// Activo que se puede agregar: asignado, del centro de costo elegido y sin otra devolucion vigente.
export interface AssetReturnCandidate {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  statusCode: string;
  productName: string | null;
  holder: AssetReturnUserLabel | null;
  // Centro de costo del activo: en "mis equipos" es el que queda para la devolucion.
  costCenter: { id: number; code: number; name: string } | null;
}

export interface AssetReturnLine {
  id: number;
  assetId: number;
  tag: string;
  serialNumber: string | null;
  productName: string | null;
  // Quien lo tenia al agregarlo (al despacharse el activo pierde su tenedor).
  holder: AssetReturnUserLabel | null;
  previousStatusCode: string;
  // Estado ACTUAL del activo (MOVE_TO_RETURNED en viaje, RETURNED al recibirse).
  statusCode: string | null;
  receivedAt: string | null;
}

export interface AssetReturnSummary {
  id: number;
  // DEV<centro><aaaammddHHmmssSSS>; null hasta adjuntar la guia por primera vez.
  code: string | null;
  scope: AssetReturnScope;
  status: AssetReturnStatus;
  costCenter: { id: number; code: number; name: string } | null;
  notes: string | null;
  requestedBy: AssetReturnUserLabel | null;
  hasDocument: boolean;
  lineCount: number;
  receivedCount: number;
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
}

export interface AssetReturnDetail extends AssetReturnSummary {
  sentBy: AssetReturnUserLabel | null;
  lines: AssetReturnLine[];
}

// scope OWN: sin costCenterId (lo define el activo); OTHERS: costCenterId obligatorio.
export interface AssetReturnCreateInput {
  scope: AssetReturnScope;
  costCenterId?: number;
  assetIds: number[];
  notes?: string;
}

export interface AssetReturnDocumentResult {
  code: string;
  filename: string;
}
