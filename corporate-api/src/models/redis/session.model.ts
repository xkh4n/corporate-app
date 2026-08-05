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
