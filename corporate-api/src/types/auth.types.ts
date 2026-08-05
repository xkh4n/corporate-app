export type TokenType = "access" | "refresh";

export interface JwtPayload {
  sub: number;
  username: string;
  roleId: number;
  roleName: string;
  type: TokenType;
  jti?: string;
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
