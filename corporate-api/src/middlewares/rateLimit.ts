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
      // Solo los intentos FALLIDOS (contrasena incorrecta) gastan cupo -un
      // login correcto no cuenta. Sin esto, una racha de usuarios legitimos
      // reintentando sesion tras una caida del servicio (todos detras de la
      // misma IP corporativa/NAT, ej. una oficina completa) agotaria el
      // limite entre ellos mismos y bloquearia al resto de la empresa por 15
      // minutos -gente que no hizo nada mal. La proteccion contra fuerza
      // bruta (que genera muchos FALLOS) sigue intacta.
      skipSuccessfulRequests: true,
      store: new RedisStore({
        sendCommand: (...args: string[]) => redis.sendCommand(args),
      }),
      message: { error: "Demasiados intentos de inicio de sesion, intenta mas tarde" },
    });
  }
  return limiter;
}

// Limitadores POR USUARIO autenticado (no por IP: detras de un NAT corporativo toda la oficina
// compartiria cupo), con store en Redis compartido (las 3 replicas cuentan juntas) y prefijo propio
// para no chocar con el del login. Construccion perezosa por el mismo motivo que getLimiter().
// Siempre van DESPUES de authenticate: req.user existe ("anon" es solo un respaldo defensivo).
function createLazyUserLimiter(options: { prefix: string; windowMs: number; limit: number; message: string }) {
  let limiterInstance: RateLimitRequestHandler | null = null;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!limiterInstance) {
      limiterInstance = rateLimit({
        windowMs: options.windowMs,
        limit: options.limit,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (request) => `user:${request.user?.userId ?? "anon"}`,
        // La creacion perezosa es deliberada (ver getLimiter): el aviso de la libreria sobra.
        validate: { creationStack: false },
        store: new RedisStore({
          prefix: options.prefix,
          sendCommand: (...args: string[]) => redis.sendCommand(args),
        }),
        message: { error: options.message },
      });
    }
    limiterInstance(req, res, next);
  };
}

// Subidas de archivos (multer.memoryStorage guarda hasta 15 MB por request en memoria).
export const uploadRateLimiter = createLazyUserLimiter({
  prefix: "rl:upload:",
  windowMs: 15 * 60 * 1000,
  limit: 60,
  message: "Demasiadas subidas de archivos, intenta mas tarde",
});

// Validacion de colaborador por RUT (toma de inventario): el espacio de RUT es acotado y cada acierto
// devuelve un nombre, asi que sin freno se podia recorrer para enumerar personas.
export const holderLookupRateLimiter = createLazyUserLimiter({
  prefix: "rl:holder:",
  windowMs: 60 * 1000,
  limit: 30,
  message: "Demasiadas consultas de colaboradores, intenta mas tarde",
});

// Consulta de un equipo por TAG/serie en la toma: devuelve tenedor (con RUT); los TAG son correlativos y sin
// freno se podian recorrer para enumerar personas.
export const assetLookupRateLimiter = createLazyUserLimiter({
  prefix: "rl:invlookup:",
  windowMs: 60 * 1000,
  limit: 120,
  message: "Demasiadas consultas de equipos, intenta mas tarde",
});

// Carga masiva de activos (plan 005): validar un CSV consulta Mongo/MSSQL/Postgres por lote y iniciar/reanudar
// arranca trabajo en segundo plano. 20 acciones cada 15 minutos por usuario sobran para uso legitimo (subir, corregir
// y reintentar unas cuantas veces) y acotan el abuso. Las consultas de estado no cuentan.
export const importRateLimiter = createLazyUserLimiter({
  prefix: "rl:assetimport:",
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: "Demasiadas acciones de carga masiva, intenta mas tarde",
});

// Consultas de estado y descarga del resultado de una carga: el sondeo del front es 1 cada 2 s (30/min); cada consulta
// lee y parsea datos de Redis (hasta ~1 MB en el resultado).
export const importReadRateLimiter = createLazyUserLimiter({
  prefix: "rl:assetimportread:",
  windowMs: 60 * 1000,
  limit: 120,
  message: "Demasiadas consultas de cargas, intenta mas tarde",
});

export function loginRateLimiter(req: Request, res: Response, next: NextFunction): void {
  getLimiter()(req, res, next);
}
