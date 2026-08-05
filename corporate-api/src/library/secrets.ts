import { readFileSync } from "node:fs";

/**
 * Lee el contenido de un Docker secret (un archivo = un valor) y lo devuelve
 * sin espacios/saltos de linea. Mismo patron "*_FILE" que ya usa
 * corporate-infra (POSTGRES_PASSWORD_FILE, MSSQL_SA_PASSWORD_FILE, etc.):
 * nunca se pasa un password como valor de variable de entorno en texto plano.
 */
export function readSecretFile(path: string): string {
  return readFileSync(path, "utf8").trim();
}

/**
 * Resuelve un secret a partir del nombre de la variable de entorno que
 * contiene la RUTA al archivo (p.ej. "MSSQL_APP_USER_PASSWORD_FILE"), no el
 * valor en si.
 */
export function readSecretFromEnv(fileEnvVar: string): string {
  const path = process.env[fileEnvVar];
  if (!path) {
    throw new Error(`Falta la variable de entorno ${fileEnvVar} (ruta al secret)`);
  }
  return readSecretFile(path);
}
