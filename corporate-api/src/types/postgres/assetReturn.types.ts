import type { AssetReturnScope, AssetReturnStatus } from "../../models/postgres/assetReturn.model";

export type { AssetReturnScope };
// Solo id y nombre: las devoluciones no necesitan exponer el RUT de nadie.
export interface AssetReturnUserLabel {
  userId: number;
  fullName: string;
}

// Quien ejecuta la accion. isAdmin viene del rol del JWT/sesion (nunca del cuerpo).
export interface AssetReturnActor {
  userId: number;
  isAdmin: boolean;
}

// scope OWN: costCenterId se DERIVA del activo (todos deben compartirlo) y no se elige; con OTHERS es obligatorio.
// isAdmin: el administrador queda exento de la regla de tenedor por modo.
export interface CreateAssetReturnInput {
  scope?: AssetReturnScope;
  costCenterId?: number | null;
  assetIds: number[];
  notes?: string | null;
  requestedBy: number;
  isAdmin?: boolean;
}

export interface ReturnCandidatesQuery {
  scope: AssetReturnScope;
  costCenterId?: number | null;
  actor: AssetReturnActor;
}

// Activo que se puede agregar a una devolucion: asignado (o devaluado en uso),
// del centro de costo elegido y sin otra devolucion vigente.
export interface AssetReturnCandidate {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  statusCode: string;
  productName: string | null;
  holder: AssetReturnUserLabel | null;
  // El centro de costo del activo: en "mis equipos" es el que queda para la devolucion.
  costCenter: { id: number; code: number; name: string } | null;
}

export interface AssetReturnLineView {
  id: number;
  assetId: number;
  tag: string;
  serialNumber: string | null;
  productName: string | null;
  // Quien lo tenia al agregarlo a la devolucion (foto; se resuelve al leer).
  holder: AssetReturnUserLabel | null;
  previousStatusCode: string;
  // Estado ACTUAL del activo (MOVE_TO_RETURNED mientras viaja, RETURNED al recibirse).
  statusCode: string | null;
  receivedAt: Date | null;
}

export interface AssetReturnSummary {
  id: number;
  code: string | null;
  scope: AssetReturnScope;
  status: AssetReturnStatus;
  costCenter: { id: number; code: number; name: string } | null;
  notes: string | null;
  requestedBy: AssetReturnUserLabel | null;
  hasDocument: boolean;
  lineCount: number;
  receivedCount: number;
  sentAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
}

export interface AssetReturnDetail extends AssetReturnSummary {
  sentBy: AssetReturnUserLabel | null;
  lines: AssetReturnLineView[];
}
