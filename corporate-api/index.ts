import { createApp } from "./api";
import { env } from "./src/library/env";
import { logger } from "./src/library/logger";
import { connectPostgres } from "./src/databases/postgres/connection";
import { connectMssql } from "./src/databases/mssql/connection";
import { connectRedis } from "./src/databases/redis/connection";
import { connectMongo } from "./src/databases/mongo/connection";
import { migratePostgres } from "./src/databases/postgres/migrate";
import { migrateMssql } from "./src/databases/mssql/migrate";
import { seedBootstrapAdmin, seedGeography, seedMenuItems, seedPermissions } from "./src/databases/seed";
import { seedCostCenters } from "./src/services/postgres/costCenter.service";
import { seedProducts } from "./src/services/mongo/product.service";
import { seedProductCategories } from "./src/services/mongo/productCategory.service";
import "./src/databases/registerModels";

async function bootstrap(): Promise<void> {
  await Promise.all([connectPostgres(), connectMssql(), connectRedis(), connectMongo()]);
  await Promise.all([migratePostgres(), migrateMssql()]);
  // seedGeography es secuencial internamente (countries -> cities -> states);
  // seedCostCenters vive en Postgres, sin dependencia con la cadena anterior.
  await Promise.all([seedGeography(), seedCostCenters(), seedProductCategories(), seedProducts(), seedPermissions()]);
  // Secuencial, NO dentro del Promise.all de arriba: seedMenuItems resuelve
  // cada permissionKey del catalogo contra la tabla permissions, que recien
  // queda poblada cuando seedPermissions() termina (ver menu-catalog.ts).
  await seedMenuItems();
  await seedBootstrapAdmin();

  const app = await createApp();

  app.listen(env.port, () => {
    logger.info({ port: env.port, env: env.nodeEnv }, "corporate-api escuchando");
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, "No se pudo levantar corporate-api");
  process.exit(1);
});
