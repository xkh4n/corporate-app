// Espejo de corporate-api/src/models/postgres/permission.model.ts.
export type PermissionAction = "create" | "read" | "update" | "delete" | "approve";

// "resource:action", tal como los aplana GET /auth/me (auth.controller.ts).
export type PermissionKey = `${string}:${PermissionAction}`;

// Espejo de corporate-api/src/types/auth.types.ts (AuthenticatedUser).
export interface AuthUser {
  userId: number;
  personId: number;
  username: string;
  roleId: number;
  roleName: string;
}

export interface MeResponse {
  user: AuthUser | null;
  permissions: PermissionKey[];
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}
