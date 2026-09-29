import { createValidationError } from "../../lib/Errors/CustomError";
import type { RoomAccessRequestInput, RoomAccessType, RoomBeneficiaryKind } from "../../types/commRoom";
import { fromDateTimeLocal, toDateTimeLocal } from "../comunicaciones/commRoomUi";

// Borrador del acceso a sala de comunicaciones (plan 016) y su conversion al cuerpo que espera
// POST /service-portal/tickets. El colaborador se resuelve en la API por RUT exacto.

export interface RoomAccessDraft {
  roomId: string;
  beneficiaryKind: RoomBeneficiaryKind;
  documentId: string;
  fullName: string;
  company: string;
  reason: string;
  requestedType: RoomAccessType;
  requestedFrom: string;
  requestedUntil: string;
}

export function emptyRoomAccessDraft(): RoomAccessDraft {
  const now = new Date();
  return {
    roomId: "",
    beneficiaryKind: "INTERNAL",
    documentId: "",
    fullName: "",
    company: "",
    reason: "",
    requestedType: "TEMPORARY",
    requestedFrom: toDateTimeLocal(now),
    requestedUntil: toDateTimeLocal(new Date(now.getTime() + 8 * 3_600_000)),
  };
}

export function toRoomAccessPayload(draft: RoomAccessDraft): RoomAccessRequestInput {
  if (!draft.roomId) throw createValidationError("Elija la sala a la que necesita acceso");
  const documentId = draft.documentId.trim();
  if (documentId.length < 3) throw createValidationError("Ingrese el RUT completo de la persona que ingresará");
  if (draft.beneficiaryKind === "EXTERNAL" && (!draft.fullName.trim() || !draft.company.trim())) {
    throw createValidationError("Para una persona externa indique su nombre y su empresa");
  }
  if (draft.reason.trim().length < 5) throw createValidationError("Explique el motivo del acceso");
  const requestedFrom = fromDateTimeLocal(draft.requestedFrom);
  if (!requestedFrom) throw createValidationError("Indique desde cuándo necesita el acceso");
  const requestedUntil = draft.requestedType === "PERMANENT" ? null : fromDateTimeLocal(draft.requestedUntil);
  if (draft.requestedType !== "PERMANENT") {
    if (!requestedUntil) throw createValidationError("Indique hasta cuándo necesita el acceso");
    if (new Date(requestedUntil).getTime() <= new Date(requestedFrom).getTime()) {
      throw createValidationError("El término debe ser posterior al inicio");
    }
  }
  return {
    roomId: Number(draft.roomId),
    beneficiary:
      draft.beneficiaryKind === "INTERNAL"
        ? { kind: "INTERNAL", documentId }
        : { kind: "EXTERNAL", documentId, fullName: draft.fullName.trim(), company: draft.company.trim() },
    reason: draft.reason.trim(),
    requestedType: draft.requestedType,
    requestedFrom,
    requestedUntil,
  };
}
