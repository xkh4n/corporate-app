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
  mfaTotpSecretEnc: string | null;
  mfaEmailEnabled: boolean;
  mfaEnrolledAt: Date | null;
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

// Forma segura para respuestas HTTP: nunca se serializa passwordHash ni el secreto TOTP (aunque
// vaya cifrado). Solo se expone si el usuario tiene TOTP activo.
export type SafeUser = Omit<UserAttributes, "passwordHash" | "mfaTotpSecretEnc"> & { mfaTotpEnabled: boolean };

export interface UserWithPerson extends UserAttributes {
  person: PersonAttributes;
}
