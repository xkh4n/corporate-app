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
  // express.json() NO va aca a nivel global (hallazgo de auditoria de
  // seguridad): montado antes del router, cualquiera que alcance mailer-net
  // podia forzar el parseo de hasta 20mb por request contra CUALQUIER ruta
  // -incluida una inexistente, que recien cae en 404 despues de parsear-,
  // sin pasar "X-Mailer-Token". Ahora el limite grande (adjunto PDF en base64)
  // solo se aplica DENTRO de send.routes.ts, despues de verifySharedSecret.
  // redact: mismo hallazgo/fix que corporate-api/api.ts (auditoria de
  // seguridad 2026-08-12), nunca aplicado aca hasta la auditoria 2026-08-17
  // -sin esto, el serializer default de pino-http vuelca req.headers
  // completo, incluido "X-Mailer-Token" (la unica credencial de este
  // servicio, ver verifySharedSecret.ts) en texto plano a stdout, scrapeado
  // por corporate-monitoring/Alloy hacia Loki/Grafana. Cualquiera con
  // acceso de lectura a Grafana podia extraer el secreto y mandar correo
  // como el dominio corporativo directo, sin pasar por corporate-api.
  app.use(
    pinoHttp({
      logger,
      redact: {
        paths: ["req.headers['x-mailer-token']"],
        censor: "[Redacted]",
      },
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/send", sendRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
