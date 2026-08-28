// Espejo de corporate-api/src/models/postgres/permission.model.ts.
export type PermissionAction = "create" | "read" | "update" | "delete" | "approve";

// "resource:action", tal como los aplana GET /auth/me (auth.controller.ts).
export type PermissionKey = `${string}:${PermissionAction}`;

// Espejo de corporate-api/src/types/auth.types.ts (AuthenticatedUser), mas
// firstName/lastName que auth.controller.ts agrega solo en la respuesta de
// GET /auth/me (autoservicio, no viven en el JWT/sesion -ver el comentario
// en me()).
export interface AuthUser {
  userId: number;
  personId: number;
  username: string;
  roleId: number;
  roleName: string;
  firstName: string;
  lastName: string;
  // true tras crear el User o resetear su password via admin; se limpia con
  // un PATCH /auth/change-password exitoso (ver auth.controller.ts me()).
  mustChangePassword: boolean;
}

export interface MeResponse {
  user: AuthUser | null;
  permissions: PermissionKey[];
}

// accessToken/refreshToken solo vienen si se manda issueTokens:true (ver
// auth.controller.ts) -el SPA nunca lo hace, la sesion viaja por cookie
// httpOnly (ver AuthContext.tsx). Quedan opcionales para no mentir el tipo.
export interface LoginResponse {
  user: AuthUser;
  accessToken?: string;
  refreshToken?: string;
}
