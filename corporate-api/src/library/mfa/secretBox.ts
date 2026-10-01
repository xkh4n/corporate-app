import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM para el secreto TOTP en users.mfa_totp_secret_enc: con solo un respaldo de la BD no
// alcanza para generar codigos validos, hace falta tambien la clave (secret fuera de la BD). Formato
// "<version>.<iv>.<tag>.<cifrado>" en base64url.
//   v2: con AAD (p. ej. "user:<id>"): el cifrado queda atado a su cuenta, asi quien pueda escribir en
//       la BD no copia el secreto de una cuenta a otra (revision de seguridad 2026-10-01).
//   v1: sin AAD. Solo existio en dev antes de ese cambio; se acepta unicamente con allowV1 (el
//       caller lo pasa solo en development), porque permitiria copiar un cifrado entre cuentas.
const IV_BYTES = 12;

export function encryptSecret(plain: string, key: Buffer, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v2", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, key: Buffer, aad: string, options: { allowV1?: boolean } = {}): string {
  const [version, iv, tag, encrypted] = payload.split(".");
  if ((version !== "v2" && !(version === "v1" && options.allowV1)) || !iv || !tag || !encrypted) {
    throw new Error("Secreto cifrado con formato desconocido");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  if (version === "v2") decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
