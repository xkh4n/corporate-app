import type { Person } from "./person";
import type { SafeUser } from "./user";

// Espejo de corporate-api/src/models/postgres/purchaseRequest.model.ts (PurchaseRequestAttributes).
export type PurchaseRequestStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CLOSED" | "CANCELLED";

// requestNumber y status son generados/controlados por el servidor: nunca se mandan en create/update.
export interface PurchaseRequest {
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
  status: PurchaseRequestStatus;
  priority: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  requester: Person;
  beneficiary: Person;
  beneficiaryUser: SafeUser | null;
}

export interface PurchaseRequestCreateInput {
  requesterId: number;
  beneficiaryId: number;
  costCenterId: number;
  requesterPosition?: string;
  requesterEmail?: string;
  requesterPhone?: string;
  beneficiaryPhone?: string;
  beneficiaryUserId?: number;
  notes?: string;
  priority?: string;
}

export type PurchaseRequestUpdateInput = Partial<Omit<PurchaseRequestCreateInput, "requesterId" | "beneficiaryId" | "costCenterId">>;
