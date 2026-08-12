// Espejo de corporate-api/src/models/postgres/city.model.ts (CityAttributes).
// Catalogo de referencia sembrado por el backend: solo lectura desde el front.
export interface City {
  id: number;
  iataCodes: string | null;
  nameCity: string;
  countryId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}
