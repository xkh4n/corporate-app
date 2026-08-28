export interface AddressAttributes {
  id: number;
  personId: number | null;
  businessPartnerId: number | null;
  addressType: string;
  addressLine: string;
  stateId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// Exactamente uno de personId/businessPartnerId (CHECK a nivel de BD, ver
// mssql/migrate.ts) -se modela como una union para que TypeScript obligue
// a elegir uno en tiempo de compilacion, no solo en runtime.
export type AddressCreationAttributes = Pick<AddressAttributes, "addressType" | "addressLine" | "stateId"> &
  Partial<Pick<AddressAttributes, "createdBy">> &
  ({ personId: number; businessPartnerId?: never } | { businessPartnerId: number; personId?: never });

export type AddressUpdateAttributes = Partial<
  Pick<AddressAttributes, "addressType" | "addressLine" | "stateId" | "updatedBy">
>;
