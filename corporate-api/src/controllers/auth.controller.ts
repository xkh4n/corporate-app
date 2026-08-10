import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  getUserByUsername,
  getUserByIdOrThrow,
  touchLastLogin,
  changePassword as changeUserPassword,
} from "../services/mssql/user.service";
import { getRoleByIdOrThrow } from "../services/postgres/role.service";
import { getPermissionsForRole } from "../services/postgres/permission.service";
import { getMenuTreeForRole } from "../services/postgres/menuItem.service";
import { comparePassword } from "../library/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../library/jwt";
import {
  storeRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  invalidateUserSessions,
} from "../services/redis/session.service";
import { UnauthorizedError } from "../library/errors";
import { sendOk, sendNoContent } from "../library/response";
import type { AuthenticatedUser } from "../types/auth.types";

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

async function issueTokenPair(user: AuthenticatedUser) {
  const jti = randomUUID();
  const basePayload = {
    sub: user.userId,
    personId: user.personId,
    username: user.username,
    roleId: user.roleId,
    roleName: user.roleName,
  };
  const accessToken = signAccessToken(basePayload);
  const refreshToken = signRefreshToken(basePayload, jti);
  await storeRefreshToken(jti, user.userId);
  return { accessToken, refreshToken };
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { username, password } = req.body as z.infer<typeof loginSchema>;

    // Mensaje generico en ambos casos (usuario inexistente vs password
    // incorrecta): no darle a un atacante una forma de enumerar usuarios.
    const user = await getUserByUsername(username);
    if (!user || !user.isActive) {
      throw new UnauthorizedError("Credenciales invalidas");
    }

    const passwordMatches = await comparePassword(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedError("Credenciales invalidas");
    }

    const role = await getRoleByIdOrThrow(user.roleId);
    // Mismo mensaje generico que el resto de este bloque: un rol desactivado
    // no debe distinguirse de credenciales invalidas ante el cliente.
    if (!role.isActive) {
      throw new UnauthorizedError("Credenciales invalidas");
    }
    const authUser: AuthenticatedUser = {
      userId: user.id,
      personId: user.personId,
      username: user.username,
      roleId: role.id,
      roleName: role.name,
    };

    // Regenerar el id de sesion en el login (session fixation): la sesion
    // vieja (anonima, pre-login) nunca se reutiliza para una ya autenticada.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.user = {
      userId: authUser.userId,
      personId: authUser.personId,
      username: authUser.username,
      roleId: authUser.roleId,
      roleName: authUser.roleName,
      loginAt: new Date().toISOString(),
    };

    const tokens = await issueTokenPair(authUser);
    await touchLastLogin(authUser.userId);

    sendOk(res, { user: authUser, ...tokens }, "Login exitoso");
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
    const payload = verifyRefreshToken(refreshToken);

    if (!payload.jti || !(await isRefreshTokenValid(payload.jti, payload.sub))) {
      throw new UnauthorizedError("Refresh token invalido o revocado");
    }

    // Rotacion: el jti usado se invalida de inmediato, se emite un par nuevo.
    await revokeRefreshToken(payload.jti, payload.sub);
    const tokens = await issueTokenPair({
      userId: payload.sub,
      personId: payload.personId,
      username: payload.username,
      roleId: payload.roleId,
      roleName: payload.roleName,
    });

    sendOk(res, tokens, "Tokens renovados exitosamente");
  } catch (err) {
    next(err instanceof UnauthorizedError ? err : new UnauthorizedError("Refresh token invalido"));
  }
}

// Body opcional: un cliente puede llamar a logout sin refreshToken (solo
// quiere limpiar su cookie de sesion).
export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
    let userId: number | undefined;

    if (refreshToken) {
      try {
        const payload = verifyRefreshToken(refreshToken);
        userId = payload.sub;
        if (payload.jti) await revokeRefreshToken(payload.jti, payload.sub);
      } catch {
        // Token ya invalido/expirado: no hay nada que revocar, no es un error de logout.
      }
    }

    if (req.session?.user) {
      userId = userId ?? req.session.user.userId;
    }

    if (req.session) {
      await new Promise<void>((resolve, reject) => {
        req.session.destroy((err) => (err ? reject(err) : resolve()));
      });
    }

    if (userId !== undefined) {
      await invalidateUserSessions(userId, "logout");
    }

    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

// Incluye los permisos del propio rol (aplanados "resource:action") ademas
// del usuario: es el unico endpoint que un no-admin tiene para saber que
// puede hacer -GET /roles/:id/permissions exige "roles:update" (admin-only),
// asi que el frontend arma su navegacion a partir de esto. "admin" tiene
// bypass hardcodeado en authorize() (ver middlewares/authorize.ts), no
// depende de este array para tener acceso real.
export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendOk(res, { user: null, permissions: [] }, "Usuario actual obtenido exitosamente");
      return;
    }

    const roleId = req.user.roleId;
    const permissions = (await getPermissionsForRole(roleId)).map((p) => `${p.resource}:${p.action}`);
    sendOk(res, { user: req.user, permissions }, "Usuario actual obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

// Arbol de navegacion ya podado a lo que el rol del usuario puede ver (ver
// getMenuTreeForRole en services/postgres/menuItem.service.ts). Separado de
// "me" a proposito: ese es liviano y se llama seguido (chequeo de sesion al
// montar la app), armar el arbol completo es mas trabajo y no siempre hace
// falta en el mismo momento.
export async function menu(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendOk(res, { menu: [] }, "Menu obtenido exitosamente");
      return;
    }

    const tree = await getMenuTreeForRole(req.user.roleId, req.user.roleName === "admin");
    sendOk(res, { menu: tree }, "Menu obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

// Auto-servicio: cualquier usuario autenticado cambia SU PROPIA contraseña,
// a diferencia de PATCH /users/:id/password (requiere permiso "users:update"
// -uso administrativo, no valida contraseña actual). Por eso aca si se exige
// currentPassword antes de delegar a userService.changePassword.
export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const userId = req.user!.userId;

    const user = await getUserByIdOrThrow(userId);
    const passwordMatches = await comparePassword(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedError("Contraseña actual incorrecta");
    }

    await changeUserPassword(userId, newPassword);

    // Mismo criterio que el cambio administrativo (ver user.controller.ts):
    // invalida todas las sesiones/refresh tokens, incluida la que hizo este
    // request -el cliente debe iniciar sesion de nuevo con la contraseña
    // nueva.
    await revokeAllRefreshTokens(userId);
    await invalidateUserSessions(userId, "password_changed");

    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
