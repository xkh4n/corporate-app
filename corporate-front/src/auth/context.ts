import { createContext } from "react";
import type { AuthUser, PermissionKey } from "../types/auth";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  permissions: PermissionKey[];
  sessionNotice: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (key: PermissionKey) => boolean;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
