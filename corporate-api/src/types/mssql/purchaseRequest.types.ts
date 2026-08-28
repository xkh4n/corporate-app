export interface PurchaseRequestAttributes {
  id: number;
  requestNumber: string;
  requesterId: number;
  requesterPosition: string | null;
  requesterEmail: string | null;
  requesterPhone: string | null;
  beneficiaryId: number;
  beneficiaryPhone: string | null;
  beneficiaryUserId: number | null;
  costCenterId: number;
  notes: string | null;
  status: string;
  priority: string;
  // Usuario asignado para revisar/aprobar la solicitud (debe tener el
  // permiso purchase-requests:approve, validado en createPurchaseRequest).
  // Nullable a nivel de columna solo por compatibilidad con filas creadas
  // antes de este campo -toda solicitud nueva lo exige (ver
  // PurchaseRequestCreationAttributes).
  approverId: number | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// requestNumber no se acepta como input: lo genera el service via
// generateDocumentNumber("SOL", ...) dentro de la misma transaccion que el
// insert. status tampoco: nace en "DRAFT" (default de columna) y cambia
// solo via updatePurchaseRequestStatus.
export type PurchaseRequestCreationAttributes = Pick<
  PurchaseRequestAttributes,
  "requesterId" | "beneficiaryId" | "costCenterId"
> & {
  // A diferencia de PurchaseRequestAttributes.approverId (nullable, por
  // compatibilidad con filas viejas), toda solicitud NUEVA exige un
  // aprobador -no se acepta null aca.
  approverId: number;
} & Partial<
    Pick<
      PurchaseRequestAttributes,
      | "requesterPosition"
      | "requesterEmail"
      | "requesterPhone"
      | "beneficiaryPhone"
      | "beneficiaryUserId"
      | "notes"
      | "priority"
      | "createdBy"
      | "updatedBy"
    >
  >;

export type PurchaseRequestUpdateAttributes = Partial<
  Pick<
    PurchaseRequestAttributes,
    | "requesterPosition"
    | "requesterEmail"
    | "requesterPhone"
    | "beneficiaryPhone"
    | "beneficiaryUserId"
    | "notes"
    | "priority"
    | "updatedBy"
  >
>;
