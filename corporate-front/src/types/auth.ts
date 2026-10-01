import type { LoginNextStep, MfaMethod } from "./mfa";

// Espejo de corporate-api/src/models/postgres/permission.model.ts.
export type PermissionAction = "create" | "read" | "update" | "delete" | "approve" | "activate" | "access" | "all_view";

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
  // Plan 017: MFA obligatorio y la cuenta no tiene ningun factor todavia; AppRoutes manda a
  // /mfa/enroll antes de cualquier otra pantalla.
  mfaEnrollmentRequired: boolean;
  // Tiene al menos un segundo factor activo (escudo verde/rojo en la barra superior).
  mfaEnrolled: boolean;
}

export interface MeResponse {
  user: AuthUser | null;
  permissions: PermissionKey[];
}

// accessToken/refreshToken solo vienen si se manda issueTokens:true (ver
// auth.controller.ts) -el SPA nunca lo hace, la sesion viaja por cookie
// httpOnly (ver AuthContext.tsx). Quedan opcionales para no mentir el tipo.
//
// Plan 017: si next es EMAIL_VERIFY o MFA el login quedo a medio camino (sin user) y methods dice
// con que puede terminarlo; /auth/mfa/verify responde con esta misma forma al completarlo.
export interface LoginResponse {
  user?: AuthUser;
  next: LoginNextStep;
  methods?: MfaMethod[];
  accessToken?: string;
  refreshToken?: string;
}
