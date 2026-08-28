// Espejo de corporate-api/src/models/postgres/state.model.ts (StateAttributes).
// Subdivision administrativa (comuna, no "state" de EE.UU.). Catalogo de
// referencia sembrado por el backend: solo lectura desde el front.
export interface State {
  id: number;
  territorialCode: string | null;
  postalCode: string | null;
  siiCode: string | null;
  nameState: string;
  cityId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}
