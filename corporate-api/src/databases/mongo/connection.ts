import mongoose from "mongoose";
import { env } from "../../library/env";
import { readSecretFromEnv } from "../../library/secrets";
import { logger } from "../../library/logger";

const password = readSecretFromEnv(env.mongo.passwordFileVar);

// Conecta directo al nodo primario (arthurus01dev), sin "replicaSet=rs0" en
// el URI -mismo criterio que postgres/mssql en este proyecto: hosts ya
// resueltos al primario a nivel de compose.dev.yml, sin failover
// client-side. authSource=admin porque el usuario de aplicacion se crea en
// esa base (ver corporate-infra/MongoDB/init.sh), aunque sus permisos
// (readWrite) esten scoped solo a MONGO_DATABASE.
const uri = `mongodb://${encodeURIComponent(env.mongo.user)}:${encodeURIComponent(password)}@${env.mongo.host}:${env.mongo.port}/${env.mongo.database}?authSource=admin`;

export async function connectMongo(): Promise<void> {
  await mongoose.connect(uri);
  logger.info({ host: env.mongo.host, database: env.mongo.database }, "MongoDB conectado");
}
