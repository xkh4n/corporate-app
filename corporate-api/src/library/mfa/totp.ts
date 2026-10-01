import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// TOTP (RFC 6238) sobre HOTP (RFC 4226) con los parametros que entienden todas las apps
// autenticadoras (Google/Microsoft Authenticator, Authy...): SHA-1, 6 digitos, pasos de 30 s. Sin
// dependencia externa: son ~40 lineas de node:crypto y se prueban contra los vectores de la RFC.
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
// Tolerancia de reloj: el paso actual y uno a cada lado (±30 s).
const WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Secreto TOTP con caracteres invalidos");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 20 bytes = 160 bits, el tamaño recomendado por la RFC 4226 para HMAC-SHA1.
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return binary.toString().padStart(TOTP_DIGITS, "0");
}

export function totpStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
}

// Devuelve el paso que coincidio (para el anti-replay, ver services/redis/mfa.service.ts) o null.
// Compara siempre los 3 candidatos con timingSafeEqual para no filtrar cual estuvo cerca.
export function verifyTotp(secretBase32: string, code: string, atMs: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(atMs);
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const step = current + delta;
    if (step < 0) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), given) && matched === null) matched = step;
  }
  return matched;
}

// URI que leen las apps al escanear el QR. issuer va dos veces (etiqueta y parametro) por
// compatibilidad con apps viejas que solo miran uno de los dos.
export function buildOtpauthUri(params: { secret: string; accountName: string; issuer: string }): string {
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.accountName)}`;
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
