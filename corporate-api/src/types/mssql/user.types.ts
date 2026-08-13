import type { PersonAttributes } from "./person.types";

export interface UserAttributes {
  id: number;
  personId: number;
  roleId: number;
  username: string;
  passwordHash: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type UserCreationAttributes = Pick<
  UserAttributes,
  "personId" | "roleId" | "username" | "passwordHash"
> &
  Partial<Pick<UserAttributes, "isActive" | "mustChangePassword">>;

export type UserUpdateAttributes = Partial<
  Pick<UserAttributes, "roleId" | "username" | "isActive">
>;

// Forma segura para respuestas HTTP: nunca se serializa passwordHash.
export type SafeUser = Omit<UserAttributes, "passwordHash">;

export interface UserWithPerson extends UserAttributes {
  person: PersonAttributes;
}
