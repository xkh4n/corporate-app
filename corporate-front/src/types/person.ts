// Espejo de corporate-api/src/models/postgres/person.model.ts (PersonAttributes).
export interface Person {
  id: number;
  firstName: string;
  // Apellido paterno en los alta nuevos; en personas anteriores puede traer
  // ambos apellidos juntos.
  lastName: string;
  maternalLastName: string | null;
  sex: PersonSex | null;
  nationality: PersonNationality | null;
  documentId: string;
  email: string;
  phone: string | null;
  birthDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Tablas 1 y 2 de Previred: M/F y 0 chileno / 1 extranjero.
export type PersonSex = "M" | "F";
export type PersonNationality = 0 | 1;

export interface PersonCreateInput {
  firstName: string;
  lastName: string;
  maternalLastName?: string;
  sex?: PersonSex;
  nationality?: PersonNationality;
  documentId: string;
  email: string;
  phone?: string;
  birthDate?: string;
  isActive?: boolean;
}

export type PersonUpdateInput = Partial<PersonCreateInput>;
