import type { Person } from "./person";
import type { Role } from "./role";
import type { Permission } from "./permission";

// Espejo de corporate-api/src/models/postgres/user.model.ts (UserAttributes),
// sin el hash de password -el backend nunca lo devuelve en las respuestas.
export interface SafeUser {
  id: number;
  personId: number;
  roleId: number;
  username: string;
  isActive: boolean;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  person: Person;
}

export interface UserAccess {
  user: SafeUser;
  role: Role;
  permissions: Permission[];
}

export interface UserCreateInput {
  personId: number;
  roleId: number;
  username: string;
  // Sin mandarla, el backend aplica la password fija por defecto y marca
  // mustChangePassword (ver createUser en corporate-api/user.service.ts) -es
  // lo que usa el alta de colaborador, que no le pide password a quien crea.
  password?: string;
}

export interface UserUpdateInput {
  roleId?: number;
  username?: string;
  isActive?: boolean;
}
