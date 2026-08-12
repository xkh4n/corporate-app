// Espejo de corporate-api/src/models/postgres/person.model.ts (PersonAttributes).
export interface Person {
  id: number;
  firstName: string;
  lastName: string;
  documentId: string;
  email: string;
  phone: string | null;
  birthDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonCreateInput {
  firstName: string;
  lastName: string;
  documentId: string;
  email: string;
  phone?: string;
  birthDate?: string;
  isActive?: boolean;
}

export type PersonUpdateInput = Partial<PersonCreateInput>;
