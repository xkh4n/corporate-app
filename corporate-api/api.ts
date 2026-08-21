import { hostname } from "node:os";
import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import pinoHttp from "pino-http";
import { env } from "./src/library/env";
import { readSecretFromEnv } from "./src/library/secrets";
import { redis } from "./src/databases/redis/connection";
import { logger } from "./src/library/logger";
import { apiRouter } from "./src/routes";
import { notFoundHandler, errorHandler } from "./src/middlewares/errorHandler";
import { metricsMiddleware, metricsHandler } from "./src/library/metrics";

// Identidad de esta replica (hostname del contenedor, p.ej. "miaplacidus01dev"):
// se usa en /health y en el header X-Api-Instance para poder ver, en las
// pruebas de balanceo de carga, que las 3 replicas realmente estan recibiendo
// trafico -no hay otra forma de distinguirlas desde afuera de NGINX-.
const instanceId = hostname();

// connect-redis (>=8) es ESM-only ("type": "module"): el resto del proyecto
// es CommonJS a proposito (ver tsconfig.json), asi que se importa dinamico
// aca en vez de con un "import" estatico -Node soporta import() ESM desde un
// modulo CJS sin problema, es la unica forma de consumir el paquete tal cual.
//
// Extraido de createApp() para que index.ts pueda pasarle la MISMA instancia
// tanto a Express (sesion HTTP normal) como a Socket.IO (io.engine.use, ver
// library/realtime/socketServer.ts) -asi el handshake del socket reusa
// exactamente la misma sesion Redis que REST, sin token nuevo.
export async function createSessionMiddleware(): Promise<RequestHandler> {
  const { RedisStore } = await import("connect-redis");
  const sessionSecret = readSecretFromEnv(env.session.secretFileVar);

  return session({
    store: new RedisStore({ client: redis, prefix: "sess:" }),
    name: env.session.name,
    secret: sessionSecret,
    cookie: {
      httpOnly: true,
      // Fijo en true, no derivado de NODE_ENV: en este proyecto NGINX
      // SIEMPRE termina TLS (autofirmado en dev, real en prod), incluido
      // el ambiente "development" -atarlo a NODE_ENV dejaba la cookie de
      // sesion viajando sin el flag Secure en dev pese a que el canal real
      // ya es HTTPS (hallazgo de auditoria de seguridad 2026-08-07).
      secure: true,
      sameSite: "lax",
      maxAge: env.session.ttlHours * 60 * 60 * 1000,
    },
    resave: false,
    saveUninitialized: false,
  });
}

export async function createApp(sessionMiddleware: RequestHandler): Promise<Express> {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  // CORS_ORIGIN="*" (default de dev, sin frontend todavia) es intencionalmente
  // incompatible con credentials:true -la spec Fetch prohibe esa combinacion,
  // y navegadores modernos ya la bloquean del lado del cliente, pero es un
  // footgun real: el dia que exista corporate-front, "arreglarlo" reflejando
  // cualquier origen (origin:true) sin querer abriria acceso cross-origin
  // credencial a cualquier sitio (hallazgo de auditoria de seguridad
  // 2026-08-07). Con "*" se desactivan las credenciales (no hay cliente
  // browser real todavia que las necesite); un CORS_ORIGIN real debe ser una
  // lista separada por comas de origenes exactos, nunca "*".
  const allowedOrigins = env.corsOrigin === "*" ? "*" : env.corsOrigin.split(",").map((origin) => origin.trim());
  app.use(cors({ origin: allowedOrigins, credentials: env.corsOrigin !== "*" }));
  app.use(express.json());
  app.use(cookieParser());
  // redact: sin esto, el serializer default de pino-http vuelca req.headers
  // completo -incluidos Cookie (la sesion httpOnly "sid") y Authorization
  // (JWT bearer)- en texto plano a stdout, que corporate-monitoring/Alloy
  // scrapea hacia Loki/Grafana. Eso permite secuestrar la sesion de
  // cualquier usuario con solo leer los logs, sin pasar por XSS -bypassea
  // el flag httpOnly por un camino server-side (hallazgo de auditoria de
  // seguridad 2026-08-12, confirmado en vivo con curl + docker logs).
  app.use(
    pinoHttp({
      logger,
      redact: {
        paths: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"],
        censor: "[Redacted]",
      },
    }),
  );
  app.use(metricsMiddleware);
  app.use((_req, res, next) => {
    res.set("X-Api-Instance", instanceId);
    next();
  });

  app.use(sessionMiddleware);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", instance: instanceId });
  });

  // Sin autenticacion a proposito, mismo criterio que los exporters de
  // corporate-infra: la proteccion es de red (solo Prometheus, via la red
  // "api-exporters", puede llegar a este puerto), no de aplicacion. NGINX
  // (nginx-apidev, el unico camino publico) nunca reenvia "/metrics".
  app.get("/metrics", metricsHandler);

  app.use("/api", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
