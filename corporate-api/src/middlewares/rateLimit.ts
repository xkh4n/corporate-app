import type { NextFunction, Request, Response } from "express";
import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../databases/redis/connection";

// Freno de fuerza bruta sobre /auth/login. No distingue por usuario, solo
// por IP (default de express-rate-limit): suficiente como primera capa;
// bloqueo por usuario/lockout queda para un pase futuro si hace falta.
//
// Store compartido en Redis (mismo cliente que sesiones/refresh tokens, ver
// databases/redis/connection.ts) -antes usaba el MemoryStore default, que
// cuenta por PROCESO: con 3 replicas de apidev detras de NGINX round-robin,
// el limite real efectivo era hasta 3x el declarado, y se reseteaba solo con
// reiniciar cualquier replica (hallazgo de auditoria de seguridad
// 2026-08-07). Con un store compartido, el limite aplica a nivel de cluster.
//
// Construccion PEREZOSA a proposito: "src/routes/auth.routes.ts" (y con el,
// este modulo) se importa de forma estatica desde "api.ts", que a su vez
// "index.ts" importa ANTES de correr bootstrap()/connectRedis() -si
// rateLimit({store:new RedisStore(...)}) se llamara al cargar el modulo (top
// level), express-rate-limit dispara el init() del store (carga un script
// Lua) de inmediato, con el cliente de Redis todavia sin conectar. Esa
// llamada fallaba con "ClientClosedError" y, al fallar el init una sola vez,
// el store quedaba roto para siempre (nunca se reintenta) -bug real
// encontrado al verificar este mismo fix en vivo, no en la auditoria
// original-. Retrasando la construccion hasta el primer request real, Redis
// ya esta conectado (bootstrap() lo hace antes de app.listen()).
let limiter: RateLimitRequestHandler | null = null;

function getLimiter(): RateLimitRequestHandler {
  if (!limiter) {
    limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand: (...args: string[]) => redis.sendCommand(args),
      }),
      message: { error: "Demasiados intentos de inicio de sesion, intenta mas tarde" },
    });
  }
  return limiter;
}

export function loginRateLimiter(req: Request, res: Response, next: NextFunction): void {
  getLimiter()(req, res, next);
}
