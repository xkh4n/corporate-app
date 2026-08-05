import type { NextFunction, Request, Response } from "express";
import { env } from "../env";
import { verifyAccessToken } from "../jwt";
import { UnauthorizedError } from "../errors";
import type { AuthenticatedUser } from "../../types/auth.types";

function fromSession(req: Request): AuthenticatedUser | undefined {
  const sessionUser = req.session?.user;
  if (!sessionUser) return undefined;
  return {
    userId: sessionUser.userId,
    personId: sessionUser.personId,
    username: sessionUser.username,
    roleId: sessionUser.roleId,
    roleName: sessionUser.roleName,
  };
}

function fromBearerToken(req: Request): AuthenticatedUser | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;

  const token = header.slice("Bearer ".length).trim();
  const payload = verifyAccessToken(token);
  return {
    userId: payload.sub,
    personId: payload.sub,
    username: payload.username,
    roleId: payload.roleId,
    roleName: payload.roleName,
  };
}

// Acepta sesion Redis (cookie) O JWT access token (Authorization: Bearer),
// en ese orden -clientes con cookie (front web) y clientes stateless
// (mobile/integraciones) conviven con el mismo guard.
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  if (env.flags.disableAuth) {
    next();
    return;
  }

  try {
    const user = fromSession(req) ?? fromBearerToken(req);
    if (!user) {
      throw new UnauthorizedError("Se requiere sesion o token de acceso");
    }
    req.user = user;
    next();
  } catch (err) {
    next(err instanceof UnauthorizedError ? err : new UnauthorizedError("Token invalido o expirado"));
  }
}
