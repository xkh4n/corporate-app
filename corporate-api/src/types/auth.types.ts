export type TokenType = "access" | "refresh";

export interface JwtPayload {
  sub: number;
  personId: number;
  username: string;
  roleId: number;
  roleName: string;
  type: TokenType;
  jti?: string;
  // Plan 015: la sesion entro con una password que el usuario no eligio (ver authenticate.ts).
  mustChangePassword?: boolean;
  // Plan 017: MFA obligatorio y sin ningun factor enrolado todavia (ver authenticate.ts).
  mfaEnrollmentRequired?: boolean;
  // Agregado automaticamente por jsonwebtoken al firmar (epoch seconds), no
  // se setea a mano -se usa en authenticate.ts para el watermark de
  // invalidacion (ver services/redis/session.service.ts).
  iat?: number;
}

export interface AuthenticatedUser {
  userId: number;
  personId: number;
  username: string;
  roleId: number;
  roleName: string;
}

export interface LoginRequestBody {
  username: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      // Plan 015: la sesion o el token trae la marca de cambio de password obligatorio.
      passwordChangePending?: boolean;
      // Plan 017: la sesion o el token trae la marca de enrolamiento de MFA pendiente.
      mfaEnrollmentPending?: boolean;
    }
  }
}
