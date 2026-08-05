import { hostname } from "node:os";
import express, { type Express } from "express";
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
export async function createApp(): Promise<Express> {
  const { RedisStore } = await import("connect-redis");
  const sessionSecret = readSecretFromEnv(env.session.secretFileVar);

  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));
  app.use(metricsMiddleware);
  app.use((_req, res, next) => {
    res.set("X-Api-Instance", instanceId);
    next();
  });

  app.use(
    session({
      store: new RedisStore({ client: redis, prefix: "sess:" }),
      name: env.session.name,
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: env.nodeEnv === "production",
        sameSite: "lax",
        maxAge: env.session.ttlHours * 60 * 60 * 1000,
      },
    }),
  );

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
