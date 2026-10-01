import { createContext } from "react";
import type { AuthUser, PermissionKey } from "../types/auth";
import type { MenuNode } from "../types/menu";
import type { MfaChallenge } from "../types/mfa";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  permissions: PermissionKey[];
  menu: MenuNode[];
  sessionNotice: string | null;
  // null = sesion iniciada; si no, el login quedo esperando el segundo factor (plan 017).
  login: (username: string, password: string) => Promise<MfaChallenge | null>;
  // Despues de POST /auth/mfa/verify exitoso: carga la sesion recien completada.
  completeMfaLogin: () => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  can: (key: PermissionKey) => boolean;
  // Vuelve a pedir /auth/me y /auth/menu sin cerrar la sesion -ej. despues
  // de crear un item de menu, para que aparezca en el sidebar sin recargar.
  refreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
