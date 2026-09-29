import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function intEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

// Hosts/puertos ya resuelven al nodo primario de cada motor, fully-qualified
// con el SUFFIX del ambiente (misma convencion que los exporters de
// corporate-infra: la concatenacion "${HOST}01${SUFFIX}" se hace a nivel de
// compose.dev.yml, la app solo lee el valor final).
export const env = {
  nodeEnv: optionalEnv("NODE_ENV", "development"),
  suffix: optionalEnv("SUFFIX", "dev"),
  port: intEnv("PORT", 3000),
  corsOrigin: optionalEnv("CORS_ORIGIN", "*"),

  postgres: {
    host: optionalEnv("POSTGRES_HOST", "localhost"),
    port: intEnv("POSTGRES_INTERNAL_PORT", 5432),
    database: requireEnv("POSTGRES_DATABASE"),
    user: requireEnv("PG_APP_USER"),
    passwordFileVar: "PG_APP_USER_PASSWORD_FILE",
  },

  mssql: {
    host: optionalEnv("MSSQL_HOST", "localhost"),
    port: intEnv("MSSQL_INTERNAL_PORT", 1433),
    database: requireEnv("MSSQL_DBNAME"),
    user: requireEnv("MSSQL_APP_USER"),
    passwordFileVar: "MSSQL_APP_USER_PASSWORD_FILE",
    // Default true en todos lados (Development/Testing/Production ya
    // conectan por hostname de contenedor, nunca por IP). Solo
    // corporate-api/.env.test lo pone en false: tedious tiene un bug/
    // limitacion conocida (message-io.js startTls pasa el host directo como
    // TLS "servername" sin el guard "es una IP?" que si tiene el otro path
    // de encryption, connection-manager.js) que hace que Node rechace la
    // conexion cuando el host es un literal de IP -exactamente el caso de
    // los tests de integracion corriendo en el host contra el puerto
    // publicado del stack de Testing (ver TESTING.md)-. No degrada
    // Development/Testing/Production: ninguno de esos conecta por IP.
    encrypt: boolEnv("MSSQL_ENCRYPT", true),
  },

  redis: {
    host: optionalEnv("REDIS_HOST", "localhost"),
    port: intEnv("REDIS_INTERNAL_PORT", 6379),
    // Usuario ACL propio de la API (REDIS_APP_USER+SUFFIX en corporate-infra,
    // sin @admin/@dangerous). Vacio = usuario "default" (el administrador):
    // solo para entornos sin ese usuario creado.
    user: optionalEnv("REDIS_USER", ""),
    passwordFileVar: "REDIS_PASSWORD_FILE",
    // Indice de base logica dentro de la misma instancia (SELECT n), no un
    // host/puerto distinto. Default 0 (el que ya usan sesiones/refresh
    // tokens reales); los tests de integracion usan REDIS_DB=1 para no
    // mezclar sus claves con las sesiones de dev.
    db: intEnv("REDIS_DB", 0),
  },

  mongo: {
    host: optionalEnv("MONGO_HOST", "localhost"),
    port: intEnv("MONGO_INTERNAL_PORT", 27017),
    database: requireEnv("MONGO_DATABASE"),
    user: requireEnv("MONGO_USER"),
    passwordFileVar: "MONGO_USER_PASSWORD_FILE",
    // Default false en todos lados: Development/Testing/Production conectan
    // al primario DENTRO de la misma red Docker, donde tambien puede
    // alcanzar (por hostname) al resto del replica set para el discovery
    // normal del driver. Solo corporate-api/.env.test lo pone en true: desde
    // el host, unicamente el primario esta publicado (ver nginx L4 de
    // corporate-infra) -sin directConnection, el driver intenta descubrir
    // secundario/arbiter por su hostname interno de Docker, no resuelve
    // desde el host, y la conexion se cuelga hasta el timeout del hook de
    // Vitest en vez de fallar rapido-.
    directConnection: boolEnv("MONGO_DIRECT_CONNECTION", false),
  },

  pool: {
    max: intEnv("MAX_POOL", 10),
    min: intEnv("MIN_POOL", 2),
  },

  session: {
    name: optionalEnv("SESSION_NAME", "sid"),
    ttlHours: intEnv("SESSION_TTL_HOURS", 8),
    secretFileVar: "SESSION_SECRET_FILE",
  },

  jwt: {
    accessTtlSeconds: intEnv("JWT_ACCESS_TTL", 43200),
    refreshTtlSeconds: intEnv("JWT_REFRESH_TTL", 604800),
    accessSecretFileVar: "JWT_ACCESS_SECRET_FILE",
    refreshSecretFileVar: "JWT_REFRESH_SECRET_FILE",
  },

  password: {
    minLength: intEnv("PASSWORD_MIN_LENGTH", 12),
    historyLimit: intEnv("PASSWORD_HISTORY_LIMIT", 5),
  },

  flags: {
    disableAuth: boolEnv("DISABLE_AUTH", false),
    disablePermissions: boolEnv("DISABLE_PERMISSIONS", false),
    disableValidation: boolEnv("DISABLE_VALIDATION", false),
  },

  // Password del usuario "admin" de arranque (services/mssql/seed.ts), solo
  // se usa la primera vez que la tabla users esta vacia.
  bootstrap: {
    adminPasswordFileVar: "ADMIN_BOOTSTRAP_PASSWORD_FILE",
  },

  // Datos de prueba (plan 014): ruta al JSON con roles, cargos y colaboradores. Solo lo montan
  // compose.dev/test (corporate-secrets, fuera de git); en produccion no existe y la semilla no corre.
  seedTestDataFileVar: "SEED_TEST_DATA_FILE",

  // Password fija que createUser() aplica cuando quien crea el User no manda
  // una (ver services/mssql/user.service.ts) -flujo tipico: alta de
  // colaborador desde el front, que no le pide password a quien lo crea.
  // Siempre viene acompañada de mustChangePassword:true en ese caso.
  users: {
    defaultPasswordFileVar: "DEFAULT_USER_PASSWORD_FILE",
  },

  // corporate-mailer (unico contenedor del proyecto con salida a internet,
  // ver library/mailerClient.ts): sin "requireEnv" a proposito -si falta,
  // sendMailViaMailer devuelve {ok:false} en vez de tumbar el arranque de
  // corporate-api por un servicio que es best-effort.
  mailer: {
    url: optionalEnv("MAILER_URL", ""),
    sharedSecretFileVar: "MAILER_SHARED_SECRET_FILE",
  },
} as const;

// Hallazgo de auditoria de seguridad 2026-08-17: hasta aca, los 3
// kill-switches de arriba solo estaban protegidos por CONVENCION -viven
// unicamente en corporate-secrets/Development/.env, nunca en Testing/
// Production/.env (ver el comentario en Environment/.env)-, pero nada en el
// codigo impedia que alguien los pusiera en "true" directamente en
// Testing/.env o Production/.env (ej. para destrabar a un desarrollador
// durante un incidente) y se olvidara de revertirlo. Failing closed aca: si
// alguno de los 3 esta activo fuera de "development", el arranque aborta en
// vez de quedar silenciosamente sin auth/permisos/validacion en un ambiente
// alcanzable por trafico real.
if (
  env.nodeEnv !== "development" &&
  (env.flags.disableAuth || env.flags.disablePermissions || env.flags.disableValidation)
) {
  throw new Error(
    "DISABLE_AUTH/DISABLE_PERMISSIONS/DISABLE_VALIDATION solo pueden estar en true con NODE_ENV=development. " +
      `NODE_ENV actual: "${env.nodeEnv}".`,
  );
}
