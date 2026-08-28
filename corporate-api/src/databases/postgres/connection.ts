import { Sequelize } from "sequelize";
import { env } from "../../library/env";
import { readSecretFromEnv } from "../../library/secrets";
import { logger } from "../../library/logger";

const password = readSecretFromEnv(env.postgres.passwordFileVar);

export const postgres = new Sequelize({
  dialect: "postgres",
  host: env.postgres.host,
  port: env.postgres.port,
  database: env.postgres.database,
  username: env.postgres.user,
  password,
  pool: { max: env.pool.max, min: env.pool.min, idle: 10_000, acquire: 30_000 },
  logging: (msg) => logger.debug(msg),
  dialectOptions: { ssl: false },
});

export async function connectPostgres(): Promise<void> {
  await postgres.authenticate();
  logger.info({ host: env.postgres.host, database: env.postgres.database }, "Postgres conectado");
}
