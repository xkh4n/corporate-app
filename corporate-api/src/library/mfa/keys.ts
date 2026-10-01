import { createHmac, hkdfSync } from "node:crypto";
import { env } from "../env";
import { readSecretFromEnv } from "../secrets";

// Una sola clave maestra de MFA (secret mfa_encryption_key.txt) y una subclave por uso via HKDF:
// cifrar el secreto TOTP y "pimentar" los hashes de codigos (recuperacion, correo) no comparten
// clave. Se lee una vez, mismo criterio que los secrets de JWT.
type KeyPurpose = "totp-secret" | "code-hash";

const derived = new Map<KeyPurpose, Buffer>();

export function getMfaKey(purpose: KeyPurpose): Buffer {
  let key = derived.get(purpose);
  if (!key) {
    const master = readSecretFromEnv(env.mfa.encryptionKeyFileVar);
    if (master.length < 32) throw new Error("La clave de MFA debe tener al menos 32 caracteres");
    key = Buffer.from(hkdfSync("sha256", master, "corporate-api-mfa", purpose, 32));
    derived.set(purpose, key);
  }
  return key;
}

// HMAC-SHA256 con clave secreta: un codigo de 6 digitos o uno de recuperacion tiene poca entropia,
// y con un hash simple se recuperaria por fuerza bruta si se filtran Redis o la BD. Sin la clave no.
export function hashCode(code: string): string {
  return createHmac("sha256", getMfaKey("code-hash")).update(code).digest("hex");
}
