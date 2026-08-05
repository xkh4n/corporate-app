// "Schema" de claves de Redis para este dominio (no hay tablas: la forma de
// los datos es el naming + TTL de cada key). connect-redis genera "sess:*"
// por su cuenta (session middleware); lo de aca es el whitelist de refresh
// tokens que maneja services/redis/session.service.ts.
export function refreshTokenKey(jti: string): string {
  return `refresh:${jti}`;
}

export function userRefreshTokensKey(userId: number): string {
  return `user-refresh-tokens:${userId}`;
}

// Watermark de invalidacion (ver services/redis/session.service.ts,
// invalidateUserSessions/getUserInvalidation): un valor por usuario, no uno
// por token -mucho mas liviano que un blacklist de jti's individuales.
export function userInvalidationKey(userId: number): string {
  return `user-invalidation:${userId}`;
}
