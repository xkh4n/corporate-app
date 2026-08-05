import { redis } from "../../databases/redis/connection";
import { refreshTokenKey, userRefreshTokensKey } from "../../models/redis/session.model";
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
