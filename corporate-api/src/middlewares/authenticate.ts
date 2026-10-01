import type { NextFunction, Request, Response } from "express";
import { env } from "../library/env";
import { verifyAccessToken } from "../library/jwt";
import { ForbiddenError, UnauthorizedError } from "../library/errors";
import { getUserInvalidation, type InvalidationReason } from "../services/redis/session.service";
import type { AuthenticatedUser } from "../types/auth.types";

interface ResolvedAuth {
  user: AuthenticatedUser;
  issuedAt: number; // epoch seconds - momento en que se emitio el token/sesion
  mustChangePassword: boolean;
  mfaEnrollmentRequired: boolean;
}

function fromSession(req: Request): ResolvedAuth | undefined {
  const sessionUser = req.session?.user;
  if (!sessionUser) return undefined;
  return {
    user: {
      userId: sessionUser.userId,
      personId: sessionUser.personId,
      username: sessionUser.username,
      roleId: sessionUser.roleId,
      roleName: sessionUser.roleName,
    },
    issuedAt: Math.floor(new Date(sessionUser.loginAt).getTime() / 1000),
    mustChangePassword: sessionUser.mustChangePassword === true,
    mfaEnrollmentRequired: sessionUser.mfaEnrollmentRequired === true,
  };
}

function fromBearerToken(req: Request): ResolvedAuth | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;

  const token = header.slice("Bearer ".length).trim();
  const payload = verifyAccessToken(token);
  return {
    user: {
      userId: payload.sub,
      personId: payload.personId,
      username: payload.username,
      roleId: payload.roleId,
      roleName: payload.roleName,
    },
    issuedAt: payload.iat ?? 0,
    mustChangePassword: payload.mustChangePassword === true,
    mfaEnrollmentRequired: payload.mfaEnrollmentRequired === true,
  };
}

// Mensaje especifico solo para los motivos que el usuario final debe poder
// distinguir en el frontend (para decidir si notificarle o no -ver
// controllers/user.controller.ts). "deactivated" queda deliberadamente
// afuera: se devuelve el 401 generico de siempre, sin pista adicional, para
// no darle a un usuario deshabilitado detalle sobre su propio estado.
const INVALIDATION_MESSAGES: Partial<Record<InvalidationReason, string>> = {
  role_changed: "Su sesion expiro porque se actualizo su rol. Inicie sesion nuevamente.",
  password_changed: "Su sesion expiro porque se actualizo su contraseña. Inicie sesion nuevamente.",
  mfa_reset: "Su sesion expiro porque se restablecio su segundo factor. Inicie sesion nuevamente.",
};

export const PASSWORD_CHANGE_REQUIRED = "password_change_required";
export const MFA_ENROLLMENT_REQUIRED = "mfa_enrollment_required";

// Acepta sesion Redis (cookie) O JWT access token (Authorization: Bearer),
// en ese orden -clientes con cookie (front web) y clientes stateless
// (mobile/integraciones) conviven con el mismo guard.
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  await resolveAuth(req, res, next, false);
}

// Planes 015 y 017: solo para /auth/me, /auth/menu, /auth/change-password y el enrolamiento de MFA,
// lo minimo para que una cuenta con una password que no eligio, o sin segundo factor cuando es
// obligatorio, pueda resolverlo. Cualquier otra ruta usa authenticate. Quien la use revisa
// req.passwordChangePending / req.mfaEnrollmentPending si el orden importa.
export async function authenticateAllowingPending(req: Request, res: Response, next: NextFunction): Promise<void> {
  await resolveAuth(req, res, next, true);
}

async function resolveAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
  allowPending: boolean,
): Promise<void> {
  if (env.flags.disableAuth) {
    next();
    return;
  }

  try {
    const resolved = fromSession(req) ?? fromBearerToken(req);
    if (!resolved) {
      throw new UnauthorizedError("Se requiere sesion o token de acceso");
    }

    // Watermark: si el usuario cambio de rol/contraseña o fue desactivado
    // DESPUES de que este token/sesion se emitio, se rechaza aunque el JWT
    // en si todavia no haya expirado -ver invalidateUserSessions en
    // services/redis/session.service.ts para el detalle de por que hace
    // falta esto ademas de revokeAllRefreshTokens.
    // "<=" y no "<": iat/validAfter son epoch SECONDS (granularidad de 1s),
    // asi que un login y una invalidacion que caen en el mismo segundo son
    // indistinguibles en orden -se prefiere fallar cerrado (rechazar ese
    // caso raro) a dejar pasar un token que en teoria debia caer.
    const invalidation = await getUserInvalidation(resolved.user.userId);
    if (invalidation && resolved.issuedAt <= invalidation.validAfter) {
      if (invalidation.reason === "deactivated") {
        throw new UnauthorizedError();
      }
      throw new UnauthorizedError(
        INVALIDATION_MESSAGES[invalidation.reason] ?? "Su sesion ha expirado. Inicie sesion nuevamente.",
        { reason: invalidation.reason },
      );
    }

    // Plan 015: la API no acepta la password por defecto (ni la de un reset administrativo) para
    // operar; el front ya redirige a /change-password, esto cierra el mismo camino llamando directo.
    if (resolved.mustChangePassword && !allowPending) {
      throw new ForbiddenError("Debe cambiar su contraseña antes de continuar", { reason: PASSWORD_CHANGE_REQUIRED });
    }
    // Plan 017: misma idea con el segundo factor obligatorio todavia sin enrolar.
    if (resolved.mfaEnrollmentRequired && !allowPending) {
      throw new ForbiddenError("Debe configurar un segundo factor antes de continuar", { reason: MFA_ENROLLMENT_REQUIRED });
    }

    req.user = resolved.user;
    req.passwordChangePending = resolved.mustChangePassword;
    req.mfaEnrollmentPending = resolved.mfaEnrollmentRequired;
    next();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      next(err);
      return;
    }
    next(err instanceof UnauthorizedError ? err : new UnauthorizedError("Token invalido o expirado"));
  }
}
