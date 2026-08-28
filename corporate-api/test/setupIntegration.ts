import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { afterAll, beforeAll } from "vitest";

// Tiene que aplicarse ANTES de que se evalue cualquier modulo que importe
// src/library/env.ts (las 4 conexiones de BD lo hacen y leen process.env al
// cargarse). OJO: un "import ... from" estatico de esos modulos, aunque este
// escrito MAS ABAJO en el archivo, se hoistea por encima de este
// loadEnv(...) en ESM -por eso todo lo que depende de env.ts se importa mas
// abajo con import() DINAMICO (dentro de setup()), no con import estatico:
// asi corre en el orden real del codigo, no en el orden de hoisting.
loadEnv({ path: resolve(__dirname, "../.env.test"), override: true });

type Deps = {
  postgres: typeof import("../src/databases/postgres/connection.js")["postgres"];
  mssql: typeof import("../src/databases/mssql/connection.js")["mssql"];
  redis: typeof import("../src/databases/redis/connection.js")["redis"];
  mongoose: typeof import("mongoose")["default"];
};

let deps: Deps | null = null;
let ready: Promise<void> | null = null;

// Idempotente y memoizado: cada archivo de test de integracion importa este
// setupFile por separado (asi lo corre vitest), pero solo el primero debe
// conectar/migrar/sembrar -los siguientes reusan la misma promesa.
function setup(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const [{ connectPostgres, postgres }, { connectMssql, mssql }, { connectRedis, redis }, { connectMongo }, { migratePostgres }, { migrateMssql }, { seedPermissions, seedMenuItems }, mongooseModule] =
        await Promise.all([
          import("../src/databases/postgres/connection.js"),
          import("../src/databases/mssql/connection.js"),
          import("../src/databases/redis/connection.js"),
          import("../src/databases/mongo/connection.js"),
          import("../src/databases/postgres/migrate.js"),
          import("../src/databases/mssql/migrate.js"),
          import("../src/databases/seed.js"),
          import("mongoose"),
        ]);
      await import("../src/databases/registerModels.js");

      const mongoose = mongooseModule.default;
      deps = { postgres, mssql, redis, mongoose };

      await Promise.all([connectPostgres(), connectMssql(), connectRedis(), connectMongo()]);
      await Promise.all([migratePostgres(), migrateMssql()]);
      // Solo permisos/menu: los tests de integracion necesitan filas reales
      // de "permissions" para poder probar authorize()/RBAC. seedGeography/
      // seedCostCenters/seedBootstrapAdmin quedan afuera a proposito -cada
      // test crea los datos puntuales que necesita, para no tener que
      // descontar filas sembradas al hacer aserciones sobre listados.
      await seedPermissions();
      await seedMenuItems();
    })();
  }
  return ready;
}

// beforeAll (no top-level await): este archivo compila como CommonJS
// (package.json no declara "type":"module"), y un top-level await ahi no es
// valido para tsc -aunque en runtime Vitest lo transforma a ESM via Vite y
// funcionaria igual-. beforeAll evita el problema y de paso es el patron
// estandar de Vitest para setupFiles: corre antes de CUALQUIER hook/test del
// archivo que lo importa (beforeAll siempre precede a beforeEach en el ciclo
// de vida, sin importar en que modulo se registro cada uno).
beforeAll(async () => {
  await setup();
});

afterAll(async () => {
  if (!deps) return;
  await Promise.all([deps.postgres.close(), deps.mssql.close(), deps.redis.quit(), deps.mongoose.disconnect()]);
});

type ResetTables = {
  postgres?: string[];
  mssql?: string[];
  mongo?: string[];
};

// Cada archivo de test de integracion declara, en su propio afterEach, que
// tablas/colecciones usa (ver costCenter.service.integration.test.ts) -un
// wipe parcial y explicito, no un TRUNCATE global de toda la base de test,
// para que agregar un archivo nuevo no tenga que conocer lo que usan los
// demas.
export async function resetTestData(tables: ResetTables): Promise<void> {
  await setup();
  if (!deps) throw new Error("resetTestData: setup() no dejo las conexiones listas");
  const { postgres, mssql, mongoose } = deps;

  for (const table of tables.postgres ?? []) {
    await postgres.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
  }
  // MSSQL: DELETE en vez de TRUNCATE -TRUNCATE TABLE falla en MSSQL si la
  // tabla tiene una FK entrante, aunque este vacia (restriccion del motor,
  // no de este proyecto), y varias tablas del flujo de compras SI las
  // tienen. DELETE respeta esas FKs y da el mismo resultado (tabla vacia).
  for (const table of tables.mssql ?? []) {
    await mssql.query(`DELETE FROM ${table}`);
  }
  for (const modelName of tables.mongo ?? []) {
    const model = mongoose.models[modelName];
    if (!model) throw new Error(`resetTestData: no hay ningun modelo Mongoose registrado como "${modelName}"`);
    await model.deleteMany({});
  }
}

// Cada archivo de test de integracion registra su PROPIO afterEach que llama
// a resetTestData(...) con las tablas/colecciones que le corresponden -ver
// costCenter.service.integration.test.ts para el patron completo.
