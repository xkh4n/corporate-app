import { createClient } from "redis";
import { env } from "../../library/env";
import { readSecretFromEnv } from "../../library/secrets";
import { logger } from "../../library/logger";

const password = readSecretFromEnv(env.redis.passwordFileVar);

// connect-redis (sesiones HTTP, ver api.ts) solo soporta oficialmente el
// cliente "redis" (node-redis), no ioredis -sus comandos no son compatibles
// entre si-, asi que este es el unico cliente de Redis de todo el proyecto
// (tambien lo usa services/redis/session.service.ts para el whitelist de
// refresh tokens).
export const redis = createClient({
  socket: { host: env.redis.host, port: env.redis.port },
  password,
});

redis.on("error", (err) => logger.error({ err }, "Error de conexion a Redis"));

export async function connectRedis(): Promise<void> {
  await redis.connect();
  logger.info({ host: env.redis.host }, "Redis conectado");
}
