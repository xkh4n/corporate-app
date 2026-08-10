import express, { type Express } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { logger } from "./src/library/logger";
import { sendRouter } from "./src/routes/send.routes";
import { notFoundHandler, errorHandler } from "./src/middlewares/errorHandler";

// Sin sesion/DB/migraciones -a diferencia de corporate-api, este servicio no
// tiene estado propio, solo reenvia un envio de correo al proveedor SMTP.
// No hace falta el createApp() async de corporate-api (ese era por
// connect-redis, ESM-only); acá no hay ninguna dependencia async al armar
// el app. Sin CORS: nadie llega a este servicio desde un navegador (solo
// corporate-api, server-to-server sobre mailer-net), y CORS es un mecanismo
// que el navegador impone -no aplica a un camino sin navegador.
export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: "20mb" })); // adjunto PDF viaja en base64 dentro del body
  app.use(pinoHttp({ logger }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/send", sendRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
