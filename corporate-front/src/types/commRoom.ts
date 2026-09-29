// Acceso a salas de comunicaciones (plan 016). Espeja corporate-api/src/services/postgres/commRooms.

export type RoomAccessType = "TEMPORARY" | "PERMANENT" | "SINGLE_USE";
export type RoomBeneficiaryKind = "INTERNAL" | "EXTERNAL";
export type RoomAccessGrantStatus = "ACTIVE" | "EXPIRED" | "REVOKED";
export type RoomAccessRequestStatus = "REQUESTED" | "VALIDATED" | "APPROVED" | "REJECTED" | "CANCELLED";

export const ROOM_ACCESS_TYPE_LABELS: Record<RoomAccessType, string> = {
  TEMPORARY: "Temporal",
  PERMANENT: "Permanente",
  SINGLE_USE: "Única vez",
};

export const ROOM_ACCESS_GRANT_STATUS_LABELS: Record<RoomAccessGrantStatus, string> = {
  ACTIVE: "Activo",
  EXPIRED: "Vencido",
  REVOKED: "Revocado",
};

export const ROOM_ACCESS_REQUEST_STATUS_LABELS: Record<RoomAccessRequestStatus, string> = {
  REQUESTED: "Solicitado: lo valida el Service Desk",
  VALIDATED: "Validado: esperando aprobación del responsable",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  CANCELLED: "Anulado",
};

export interface CommRoom {
  id: number;
  name: string;
  costCenterId: number;
  costCenterCode: number;
  costCenterName: string;
  address: string;
  isActive: boolean;
  activeGrants: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommRoomInput {
  name: string;
  costCenterId: number;
  address: string;
  isActive?: boolean;
}

export interface PortalCommRoom {
  id: number;
  name: string;
  costCenterName: string;
}

export interface CommRoomSettings {
  temporaryMaxActiveDays: number;
  updatedAt: string;
}

export interface RoomAccessGrant {
  id: number;
  ticketId: number;
  ticketNumber: string;
  roomId: number;
  roomName: string;
  costCenterId: number;
  costCenterName: string;
  beneficiaryKind: RoomBeneficiaryKind;
  beneficiaryName: string;
  beneficiaryDocumentId: string;
  beneficiaryCompany: string | null;
  reason: string;
  accessType: RoomAccessType;
  validFrom: string;
  validUntil: string | null;
  status: RoomAccessGrantStatus;
  isValidNow: boolean;
  validatedBy: number;
  validatedByName: string | null;
  approvedBy: number;
  approvedByName: string | null;
  approvedAt: string;
  expiredAt: string | null;
  revokedBy: number | null;
  revokedByName: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  activeDays: number;
}

export interface RoomAccessGrantDetail extends RoomAccessGrant {
  entries: RoomEntry[];
}

export interface RoomAccessGrantFilters {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  roomId?: number;
  costCenterId?: number;
  status?: RoomAccessGrantStatus;
  accessType?: RoomAccessType;
  validNow?: boolean;
  documentId?: string;
  ticketNumber?: string;
  expiredFrom?: string;
  expiredTo?: string;
  longTemporary?: boolean;
}

export interface MultiRoomHolder {
  beneficiaryDocumentId: string;
  beneficiaryName: string;
  beneficiaryKind: RoomBeneficiaryKind;
  beneficiaryCompany: string | null;
  places: number;
  rooms: { roomId: number; roomName: string; costCenterName: string; grantId: number; accessType: RoomAccessType; validUntil: string | null }[];
}

export interface RoomEntry {
  id: number;
  grantId: number;
  roomId: number;
  roomName: string;
  costCenterName: string;
  beneficiaryName: string;
  beneficiaryDocumentId: string;
  beneficiaryCompany: string | null;
  accessType: RoomAccessType;
  grantStatus: RoomAccessGrantStatus;
  ticketNumber: string;
  checkedInAt: string;
  checkedInBy: number;
  checkedInByName: string | null;
  checkedOutAt: string | null;
  checkedOutBy: number | null;
  checkedOutByName: string | null;
  notes: string | null;
}

export interface RoomEntryFilters {
  page?: number;
  limit?: number;
  sortOrder?: "asc" | "desc";
  roomId?: number;
  open?: boolean;
  documentId?: string;
  from?: string;
  to?: string;
}

// Lo que se pide al abrir el ticket (portal o agente).
export type RoomBeneficiaryInput =
  | { kind: "INTERNAL"; documentId: string }
  | { kind: "EXTERNAL"; fullName: string; documentId: string; company: string };

export interface RoomAccessRequestInput {
  roomId: number;
  beneficiary: RoomBeneficiaryInput;
  reason: string;
  requestedType: RoomAccessType;
  requestedFrom: string;
  requestedUntil?: string | null;
}

export interface RoomAccessValidationInput {
  roomId: number;
  accessType: RoomAccessType;
  validFrom: string;
  validUntil: string | null;
  notes?: string;
}
