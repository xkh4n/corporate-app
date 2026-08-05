export interface CityAttributes {
  id: number;
  iataCodes: string | null;
  nameCity: string;
  countryId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CityCreationAttributes = Pick<CityAttributes, "nameCity" | "countryId"> &
  Partial<Pick<CityAttributes, "iataCodes" | "createdBy" | "updatedBy">>;

export type CityUpdateAttributes = Partial<
  Pick<CityAttributes, "iataCodes" | "nameCity" | "countryId">
>;
