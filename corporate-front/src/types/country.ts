// Espejo de corporate-api/src/models/postgres/country.model.ts (CountryAttributes).
// Catalogo de referencia sembrado por el backend: solo lectura desde el front.
export interface Country {
  id: number;
  isoCode: string;
  iataCode: string | null;
  nameCountry: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}
