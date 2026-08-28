export interface StateAttributes {
  id: number;
  territorialCode: string | null;
  postalCode: string | null;
  siiCode: string | null;
  nameState: string;
  cityId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type StateCreationAttributes = Pick<StateAttributes, "nameState" | "cityId"> &
  Partial<Pick<StateAttributes, "territorialCode" | "postalCode" | "siiCode" | "createdBy" | "updatedBy">>;

export type StateUpdateAttributes = Partial<
  Pick<StateAttributes, "territorialCode" | "postalCode" | "siiCode" | "nameState" | "cityId">
>;
