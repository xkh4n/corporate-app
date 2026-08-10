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
  },

  redis: {
    host: optionalEnv("REDIS_HOST", "localhost"),
    port: intEnv("REDIS_INTERNAL_PORT", 6379),
    passwordFileVar: "REDIS_PASSWORD_FILE",
  },

  mongo: {
    host: optionalEnv("MONGO_HOST", "localhost"),
    port: intEnv("MONGO_INTERNAL_PORT", 27017),
    database: requireEnv("MONGO_DATABASE"),
    user: requireEnv("MONGO_USER"),
    passwordFileVar: "MONGO_USER_PASSWORD_FILE",
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

  // corporate-mailer (unico contenedor del proyecto con salida a internet,
  // ver library/mailerClient.ts): sin "requireEnv" a proposito -si falta,
  // sendMailViaMailer devuelve {ok:false} en vez de tumbar el arranque de
  // corporate-api por un servicio que es best-effort.
  mailer: {
    url: optionalEnv("MAILER_URL", ""),
    sharedSecretFileVar: "MAILER_SHARED_SECRET_FILE",
  },
} as const;
