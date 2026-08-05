export interface PersonAttributes {
  id: number;
  firstName: string;
  lastName: string;
  documentId: string;
  email: string;
  phone: string | null;
  birthDate: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type PersonCreationAttributes = Pick<
  PersonAttributes,
  "firstName" | "lastName" | "documentId" | "email"
> &
  Partial<Pick<PersonAttributes, "phone" | "birthDate" | "isActive">>;

export type PersonUpdateAttributes = Partial<
  Pick<
    PersonAttributes,
    "firstName" | "lastName" | "documentId" | "email" | "phone" | "birthDate" | "isActive"
  >
>;
