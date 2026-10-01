import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { signAccessToken, signRefreshToken } from "./jwt";
import { storeRefreshToken } from "../services/redis/session.service";
import { touchLastLogin } from "../services/mssql/user.service";
import type { AuthenticatedUser, TokenPair } from "../types/auth.types";

// Cierre comun de un login: lo usan POST /auth/login (cuenta sin segundo factor que pedir) y la
// verificacion de MFA (plan 017), que es donde termina el login de una cuenta con factor enrolado.

export interface SessionFlags {
  mustChangePassword: boolean;
  mfaEnrollmentRequired: boolean;
}

export async function issueTokenPair(user: AuthenticatedUser, flags: SessionFlags): Promise<TokenPair> {
  const jti = randomUUID();
  const basePayload = {
    sub: user.userId,
    personId: user.personId,
    username: user.username,
    roleId: user.roleId,
    roleName: user.roleName,
    ...(flags.mustChangePassword ? { mustChangePassword: true } : {}),
    ...(flags.mfaEnrollmentRequired ? { mfaEnrollmentRequired: true } : {}),
  };
  const accessToken = signAccessToken(basePayload);
  const refreshToken = signRefreshToken(basePayload, jti);
  await storeRefreshToken(jti, user.userId);
  return { accessToken, refreshToken };
}

// Session fixation: cada cambio de nivel (anonimo -> login a medio camino -> autenticado) estrena id
// de sesion. Sin sesion real (clientes solo-token o el doble de los tests) no hay nada que regenerar.
export async function regenerateSession(req: Request): Promise<void> {
  if (typeof req.session?.regenerate !== "function") return;
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

export async function completeLogin(
  req: Request,
  user: AuthenticatedUser,
  flags: SessionFlags & { issueTokens: boolean },
): Promise<TokenPair | undefined> {
  await regenerateSession(req);
  if (req.session) {
    req.session.user = {
      userId: user.userId,
      personId: user.personId,
      username: user.username,
      roleId: user.roleId,
      roleName: user.roleName,
      loginAt: new Date().toISOString(),
      ...(flags.mustChangePassword ? { mustChangePassword: true } : {}),
      ...(flags.mfaEnrollmentRequired ? { mfaEnrollmentRequired: true } : {}),
    };
  }

  const tokens = flags.issueTokens ? await issueTokenPair(user, flags) : undefined;
  await touchLastLogin(user.userId);
  return tokens;
}
