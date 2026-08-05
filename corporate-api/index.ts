import { createApp } from "./api";
import { env } from "./src/library/env";
import { logger } from "./src/library/logger";
import { connectPostgres } from "./src/databases/postgres/connection";
import { connectMssql } from "./src/databases/mssql/connection";
import { connectRedis } from "./src/databases/redis/connection";
import { connectMongo } from "./src/databases/mongo/connection";
import { migratePostgres } from "./src/databases/postgres/migrate";
import { migrateMssql } from "./src/databases/mssql/migrate";
import { seedBootstrapAdmin, seedGeography } from "./src/databases/seed";
import { seedCostCenters } from "./src/services/postgres/costCenter.service";
import { seedProducts } from "./src/services/mongo/product.service";

// Registra las asociaciones de Sequelize (belongsTo/hasOne/hasMany en cada
// *.model.ts) antes de que cualquier query las necesite.
import "./src/models/mssql/person.model";
import "./src/models/mssql/user.model";
import "./src/models/postgres/role.model";

// Geografia (country -> city -> states)
import "./src/models/mssql/country.model";
import "./src/models/mssql/city.model";
import "./src/models/mssql/state.model";

// Terceros (business_partners + extensiones supplier/customer) y empleados
import "./src/models/mssql/businessPartner.model";
import "./src/models/mssql/supplier.model";
import "./src/models/mssql/customer.model";
import "./src/models/mssql/employee.model";
import "./src/models/mssql/address.model";

// Flujo de compras: PurchaseRequest -> Quote -> Authorization -> PurchaseOrder -> GoodsReceipt
import "./src/models/mssql/purchaseRequest.model";
import "./src/models/mssql/purchaseRequestLine.model";
import "./src/models/mssql/quote.model";
import "./src/models/mssql/authorization.model";
import "./src/models/mssql/purchaseOrder.model";
import "./src/models/mssql/goodsReceipt.model";

// Activos (Postgres)
import "./src/models/postgres/costCenter.model";
import "./src/models/postgres/assetStatus.model";
import "./src/models/postgres/asset.model";
import "./src/models/postgres/assetMovement.model";
import "./src/models/postgres/assetMovementUser.model";

async function bootstrap(): Promise<void> {
  await Promise.all([connectPostgres(), connectMssql(), connectRedis(), connectMongo()]);
  await Promise.all([migratePostgres(), migrateMssql()]);
  // seedGeography es secuencial internamente (countries -> cities -> states);
  // seedCostCenters vive en Postgres, sin dependencia con la cadena anterior.
  await Promise.all([seedGeography(), seedCostCenters(), seedProducts()]);
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
