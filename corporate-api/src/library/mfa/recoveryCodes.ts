import { randomInt } from "node:crypto";

export const RECOVERY_CODE_COUNT = 10;

// Sin 0/O/1/I/L para que se puedan copiar a mano desde un papel sin confundirse.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

// "xxxxx-xxxxx": 10 caracteres de un alfabeto de 31 = ~49 bits por codigo. Suficiente porque cada
// uso pasa por el rate limit y el tope de intentos de la sesion pre-auth.
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let raw = "";
    for (let i = 0; i < 10; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
    codes.add(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return [...codes];
}

// El usuario puede tipearlo con mayusculas, espacios o sin guion.
export function normalizeRecoveryCode(input: string): string {
  const raw = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  return raw.length === 10 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
}
