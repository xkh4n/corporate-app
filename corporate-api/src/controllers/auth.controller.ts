import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getUserByUsername, touchLastLogin } from "../services/mssql/user.service";
import { getRoleByIdOrThrow } from "../services/postgres/role.service";
import { comparePassword } from "../library/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../library/jwt";
import {
  storeRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
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

    // Hallazgo de auditoria: hasta ahora logout() solo revocaba EL refresh
    // token puntual (o destruia la sesion de cookie), pero el access token
    // JWT que el cliente ya tiene en la mano seguia siendo valido hasta su
    // TTL natural (12h) aunque el usuario hiciera logout explicito. Mismo
    // mecanismo que role_changed/password_changed (ver user.controller.ts):
    // nota que esto invalida TODOS los dispositivos del usuario, no solo la
    // sesion/token que esta llamando a logout -mismo alcance que
    // revokeAllRefreshTokens, que ya se documenta como "logout de todos los
    // dispositivos"-.
    if (userId !== undefined) {
      await invalidateUserSessions(userId, "logout");
    }

    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

export function me(req: Request, res: Response): void {
  sendOk(res, { user: req.user ?? null }, "Usuario actual obtenido exitosamente");
}
