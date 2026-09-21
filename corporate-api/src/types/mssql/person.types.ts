export interface PersonAttributes {
  id: number;
  firstName: string;
  lastName: string;
  maternalLastName: string | null;
  sex: "M" | "F" | null;
  nationality: 0 | 1 | null;
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
  Partial<
    Pick<PersonAttributes, "maternalLastName" | "sex" | "nationality" | "phone" | "birthDate" | "isActive">
  >;

export type PersonUpdateAttributes = Partial<
  Pick<
    PersonAttributes,
    | "firstName"
    | "lastName"
    | "maternalLastName"
    | "sex"
    | "nationality"
    | "documentId"
    | "email"
    | "phone"
    | "birthDate"
    | "isActive"
  >
>;
