import { createValidationError } from "../../lib/Errors/CustomError";
import { IsEmail, IsPhone } from "../../lib/Validations";
import type { EquipmentPurchasePayload } from "../../types/serviceDesk";

// Borrador de los datos de compra de una solicitud de equipo (plan 010) y su
// conversion al cuerpo que espera POST /service-portal/tickets.

export interface EquipmentLine {
  clientId: string;
  productId: string;
  productName: string;
  categoryName: string;
  quantity: number;
}

export interface EquipmentDraft {
  forOther: boolean;
  beneficiaryDocumentId: string;
  beneficiary: { personId: number; fullName: string } | null;
  costCenterId: string;
  approverId: string;
  requesterEmail: string;
  requesterPhone: string;
  lines: EquipmentLine[];
}

export const EMPTY_EQUIPMENT_DRAFT: EquipmentDraft = {
  forOther: false,
  beneficiaryDocumentId: "",
  beneficiary: null,
  costCenterId: "",
  approverId: "",
  requesterEmail: "",
  requesterPhone: "",
  lines: [],
};

// Valida el borrador y lo convierte al cuerpo que espera la API.
export function toEquipmentPayload(draft: EquipmentDraft): EquipmentPurchasePayload {
  if (draft.forOther && !draft.beneficiary) throw createValidationError("Valide el RUT de la persona que recibirá el equipo");
  if (!draft.costCenterId) throw createValidationError("Seleccione el centro de costo");
  if (!draft.approverId) throw createValidationError("Seleccione quién aprueba la compra");
  const email = draft.requesterEmail.trim();
  const phone = draft.requesterPhone.trim();
  if (email && !IsEmail(email)) throw createValidationError("El correo de contacto no es válido");
  if (phone && !IsPhone(phone)) throw createValidationError("El teléfono de contacto no es válido");
  if (draft.lines.length === 0) throw createValidationError("Agregue al menos un producto");
  return {
    beneficiaryPersonId: draft.forOther ? draft.beneficiary!.personId : null,
    costCenterId: Number(draft.costCenterId),
    approverId: Number(draft.approverId),
    requesterEmail: email || undefined,
    requesterPhone: phone || undefined,
    lines: draft.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
  };
}
