// Espejo de corporate-api/src/models/postgres/address.model.ts (AddressAttributes).
export interface Address {
  id: number;
  personId: number | null;
  businessPartnerId: number | null;
  addressType: string;
  addressLine: string;
  stateId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

// Exactamente uno de personId/businessPartnerId debe venir al crear (400 si no).
export interface AddressCreateInput {
  personId?: number;
  businessPartnerId?: number;
  addressType: string;
  addressLine: string;
  stateId: number;
}

export interface AddressUpdateInput {
  addressType?: string;
  addressLine?: string;
  stateId?: number;
}
