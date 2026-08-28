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

export const env = {
  nodeEnv: optionalEnv("NODE_ENV", "development"),
  port: intEnv("PORT", 4000),

  smtp: {
    host: requireEnv("SMTP_HOST"),
    port: intEnv("SMTP_PORT", 587),
    user: requireEnv("SMTP_USER"),
    from: requireEnv("SMTP_FROM"),
    passwordFileVar: "SMTP_PASSWORD_FILE",
  },

  sharedSecretFileVar: "MAILER_SHARED_SECRET_FILE",
} as const;
