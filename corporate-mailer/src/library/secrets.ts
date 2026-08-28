import { readFileSync } from "node:fs";

/**
 * Lee el contenido de un Docker secret (un archivo = un valor) y lo devuelve
 * sin espacios/saltos de linea. Mismo patron que corporate-api/src/library/
 * secrets.ts -se duplica en vez de compartirse porque son proyectos Docker
 * independientes.
 */
export function readSecretFile(path: string): string {
  return readFileSync(path, "utf8").trim();
}

export function readSecretFromEnv(fileEnvVar: string): string {
  const path = process.env[fileEnvVar];
  if (!path) {
    throw new Error(`Falta la variable de entorno ${fileEnvVar} (ruta al secret)`);
  }
  return readSecretFile(path);
}
