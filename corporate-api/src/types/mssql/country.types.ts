export interface CountryAttributes {
  id: number;
  isoCode: string;
  iataCode: string | null;
  nameCountry: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CountryCreationAttributes = Pick<CountryAttributes, "isoCode" | "nameCountry"> &
  Partial<Pick<CountryAttributes, "iataCode" | "createdBy" | "updatedBy">>;

export type CountryUpdateAttributes = Partial<
  Pick<CountryAttributes, "isoCode" | "iataCode" | "nameCountry">
>;
