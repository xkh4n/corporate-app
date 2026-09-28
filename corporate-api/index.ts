import http from "node:http";
import { createApp, createSessionMiddleware } from "./api";
import { env } from "./src/library/env";
import { logger } from "./src/library/logger";
import { connectPostgres } from "./src/databases/postgres/connection";
import { connectMssql } from "./src/databases/mssql/connection";
import { connectRedis } from "./src/databases/redis/connection";
import { connectMongo } from "./src/databases/mongo/connection";
import { migratePostgres } from "./src/databases/postgres/migrate";
import { migrateMssql } from "./src/databases/mssql/migrate";
import { seedBootstrapAdmin, seedGeography, seedMenuItems, seedPermissions, seedPrevisional } from "./src/databases/seed";
import { seedCostCenters } from "./src/services/postgres/costCenter.service";
import { seedProducts } from "./src/services/mongo/product.service";
import { seedProductCategories } from "./src/services/mongo/productCategory.service";
import { initSocketServer } from "./src/library/realtime/socketServer";
import { startImportSweeper, stopImportWorkers } from "./src/services/redis/assetImportJob.service";
import { startServiceDeskSlaSweeper, stopServiceDeskSlaSweeper } from "./src/services/postgres/serviceDesk/slaSweeper";
import { registerPurchaseTicketSync } from "./src/services/postgres/serviceDesk/purchaseLink.service";
import "./src/databases/registerModels";

async function bootstrap(): Promise<void> {
  await Promise.all([connectPostgres(), connectMssql(), connectRedis(), connectMongo()]);
  await Promise.all([migratePostgres(), migrateMssql()]);
  // seedGeography es secuencial internamente (countries -> cities -> states);
  // seedCostCenters vive en Postgres, sin dependencia con la cadena anterior.
  await Promise.all([seedGeography(), seedCostCenters(), seedProductCategories(), seedProducts(), seedPermissions(), seedPrevisional()]);
  // Secuencial, NO dentro del Promise.all de arriba: seedMenuItems resuelve
  // cada permissionKey del catalogo contra la tabla permissions, que recien
  // queda poblada cuando seedPermissions() termina (ver menu-catalog.ts).
  await seedMenuItems();
  await seedBootstrapAdmin();

  // Misma instancia de sessionMiddleware para Express (REST) y para el
  // handshake de Socket.IO (io.engine.use, ver socketServer.ts) -asi el
  // socket reusa exactamente la misma sesion Redis que REST, sin token
  // nuevo. http.createServer(app) en vez de app.listen(): Socket.IO
  // intercepta a nivel de http.Server, antes del ruteo de Express, y
  // necesita ser el mismo servidor HTTP que atiende las requests REST.
  const sessionMiddleware = await createSessionMiddleware();
  const app = await createApp(sessionMiddleware);
  const server = http.createServer(app);
  await initSocketServer(server, sessionMiddleware);

  server.listen(env.port, () => {
    logger.info({ port: env.port, env: env.nodeEnv }, "corporate-api escuchando");
  });

  // Cargas masivas de activos (plan 005): retoma las que quedaron en curso sin worker (una replica que murio o se
  // reinicio) y, al recibir la senal de cierre, deja terminar la fila en curso antes de salir.
  startImportSweeper();
  // Service Desk (plan 009): avisos e incumplimientos de SLA y cierre automatico de resueltos. Las solicitudes de
  // equipo (plan 010) siguen a su compra: aviso inmediato en cada replica + reconciliacion en el barrido.
  registerPurchaseTicketSync();
  startServiceDeskSlaSweeper();
  registerShutdownHandlers(server);
}

let shutdownStarted = false;

// Numero de senal para el codigo de salida convencional (128 + senal), el mismo que tenia el proceso antes de que
// existiera este manejador (la senal por defecto lo termina con 143 / 130).
const SIGNAL_NUMBERS: Record<string, number> = { SIGINT: 2, SIGTERM: 15 };

function registerShutdownHandlers(server: http.Server): void {
  const shutdown = (signal: string): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    logger.info({ signal }, "Cerrando corporate-api");
    // Deja de aceptar conexiones nuevas mientras termina la fila de carga en curso (las abiertas se cortan al salir).
    server.close();
    stopServiceDeskSlaSweeper();
    stopImportWorkers()
      .catch((err) => logger.error({ err }, "Error al detener las cargas masivas"))
      .finally(() => process.exit(128 + (SIGNAL_NUMBERS[signal] ?? 15)));
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

const BOOTSTRAP_MAX_RETRIES = 5;
const BOOTSTRAP_BASE_DELAY_MS = 2000;
const BOOTSTRAP_MAX_DELAY_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// "Full jitter" (AWS, "Exponential Backoff And Jitter"): el delay real es
// aleatorio ENTRE 0 y el techo exponencial, no el techo fijo. Con las 3
// replicas de este servicio arrancando casi al mismo tiempo (mismo evento de
// arranque del stack), un backoff fijo (2s, 4s, 8s...) las haria reintentar
// sincronizadas, golpeando la BD en el mismo instante en cada vuelta -el
// jitter las desincroniza.
function backoffWithJitter(attempt: number): number {
  const cap = Math.min(BOOTSTRAP_MAX_DELAY_MS, BOOTSTRAP_BASE_DELAY_MS * 2 ** attempt);
  return Math.random() * cap;
}

// Reintenta bootstrap() completo (conexiones + migraciones + seed), no solo
// el connect: si la BD se cae a mitad de una migracion, todo el flujo ya es
// idempotente (IF NOT EXISTS / ON CONFLICT en todo el proyecto, ver
// migrate.ts y seed.ts), asi que repetirlo entero es seguro. Sin esto, una
// carrera de arranque contra un motor de BD que todavia no esta listo (ej.
// todo el stack reiniciando a la vez) tira process.exit(1) en el primer
// intento -en produccion "restart: always" + PID 1 = node (a diferencia de
// tsx watch en dev, que absorbe el crash del hijo sin reiniciar el
// contenedor) igual lo recupera solo, pero con el backoff de Docker, que
// puede tardar hasta ~1 minuto entre reintentos. Reintentando aca adentro
// primero, la carrera se resuelve en segundos.
async function bootstrapWithRetry(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await bootstrap();
      return;
    } catch (err) {
      if (attempt >= BOOTSTRAP_MAX_RETRIES) throw err;
      const delay = backoffWithJitter(attempt);
      logger.error(
        { err, attempt: attempt + 1, maxRetries: BOOTSTRAP_MAX_RETRIES, retryInMs: Math.round(delay) },
        "No se pudo levantar corporate-api, reintentando",
      );
      await sleep(delay);
    }
  }
}

bootstrapWithRetry().catch((err) => {
  logger.error({ err }, "No se pudo levantar corporate-api tras agotar los reintentos");
  process.exit(1);
});
