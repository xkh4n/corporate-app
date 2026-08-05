import pino from "pino";
import { env } from "./env";

// JSON a stdout: Alloy (corporate-monitoring) scrapea logs de contenedor via
// el log driver de Docker, no necesita un transport/pretty-print propio.
export const logger = pino({
  level: env.nodeEnv === "production" ? "info" : "debug",
  base: { service: "corporate-api" },
});
