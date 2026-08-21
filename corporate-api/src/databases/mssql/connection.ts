import { Sequelize } from "sequelize";
import { env } from "../../library/env";
import { readSecretFromEnv } from "../../library/secrets";
import { logger } from "../../library/logger";

const password = readSecretFromEnv(env.mssql.passwordFileVar);

export const mssql = new Sequelize({
  dialect: "mssql",
  host: env.mssql.host,
  port: env.mssql.port,
  database: env.mssql.database,
  username: env.mssql.user,
  password,
  pool: { max: env.pool.max, min: env.pool.min, idle: 10_000, acquire: 30_000 },
  logging: (msg) => logger.debug(msg),
  dialectOptions: {
    options: {
      // Certificado autofirmado de dev (mismo criterio que "sqlcmd -C" en
      // corporate-infra/MsSQL/scripts/*.sh): confia en el cert sin validarlo
      // contra una CA. Revisar antes de usar esto contra un ambiente real.
      encrypt: env.mssql.encrypt,
      trustServerCertificate: true,
    },
  },
});

export async function connectMssql(): Promise<void> {
  await mssql.authenticate();
  logger.info({ host: env.mssql.host, database: env.mssql.database }, "MSSQL conectado");
}
