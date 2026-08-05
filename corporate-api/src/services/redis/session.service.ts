import { redis } from "../../databases/redis/connection";
import {
  refreshTokenKey,
  userRefreshTokensKey,
  userInvalidationKey,
} from "../../models/redis/session.model";
import { env } from "../../library/env";

// Whitelist de refresh tokens en Redis: un JWT firmado no se puede "invalidar"
// por si mismo antes de que expire, asi que la revocacion real (logout,
// rotacion, cambio de password) pasa por borrar su jti de aca. Sin esto, un
// refresh token robado seguiria siendo valido hasta su expiracion aunque el
// usuario cierre sesion.
export async function storeRefreshToken(jti: string, userId: number): Promise<void> {
  const ttl = env.jwt.refreshTtlSeconds;
  await redis
    .multi()
    .set(refreshTokenKey(jti), String(userId), { EX: ttl })
    .sAdd(userRefreshTokensKey(userId), jti)
    .expire(userRefreshTokensKey(userId), ttl)
    .exec();
}

export async function isRefreshTokenValid(jti: string, userId: number): Promise<boolean> {
  const storedUserId = await redis.get(refreshTokenKey(jti));
  return storedUserId === String(userId);
}

export async function revokeRefreshToken(jti: string, userId: number): Promise<void> {
  await redis.multi().del(refreshTokenKey(jti)).sRem(userRefreshTokensKey(userId), jti).exec();
}

// Logout de todos los dispositivos (p.ej. tras un cambio de password).
export async function revokeAllRefreshTokens(userId: number): Promise<void> {
  const jtis = await redis.sMembers(userRefreshTokensKey(userId));
  if (jtis.length === 0) return;

  const pipeline = redis.multi();
  for (const jti of jtis) {
    pipeline.del(refreshTokenKey(jti));
  }
  pipeline.del(userRefreshTokensKey(userId));
  await pipeline.exec();
}

export type InvalidationReason = "role_changed" | "password_changed" | "deactivated" | "logout";

export interface UserInvalidation {
  validAfter: number; // epoch seconds
  reason: InvalidationReason;
}

// Watermark por usuario: cualquier access token/sesion emitido ANTES de
// "validAfter" se rechaza en authenticate.ts, aunque su JWT todavia no haya
// expirado -sin esto, cambiar el rol o la contraseña de alguien no tenia
// efecto sobre un access token stateless ya emitido hasta su TTL natural
// (hasta 12h), y refresh() tampoco lo corregia (re-firma con el payload
// viejo, nunca vuelve a leer la BD). revokeAllRefreshTokens sigue haciendo
// falta ademas de esto: bloquea que se emita un access token NUEVO via
// refresh (que tendria un iat fresco y pasaria el watermark igual), forzando
// un login real -el unico punto que vuelve a leer roles/password desde la
// BD-. TTL = el mas largo entre access token y sesion, con margen: pasado
// ese tiempo cualquier token afectado ya expiro solo, no hace falta seguir
// guardando el motivo.
export async function invalidateUserSessions(userId: number, reason: InvalidationReason): Promise<void> {
  const validAfter = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(env.jwt.accessTtlSeconds, env.session.ttlHours * 3600) + 60;
  await redis.set(userInvalidationKey(userId), JSON.stringify({ validAfter, reason }), {
    EX: ttlSeconds,
  });
}

export async function getUserInvalidation(userId: number): Promise<UserInvalidation | null> {
  const raw = await redis.get(userInvalidationKey(userId));
  return raw ? (JSON.parse(raw) as UserInvalidation) : null;
}
