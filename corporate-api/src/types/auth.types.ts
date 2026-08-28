export type TokenType = "access" | "refresh";

export interface JwtPayload {
  sub: number;
  personId: number;
  username: string;
  roleId: number;
  roleName: string;
  type: TokenType;
  jti?: string;
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
    }
  }
}
