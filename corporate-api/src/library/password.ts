import bcrypt from "bcryptjs";
import { env } from "./env";
import { BadRequestError } from "./errors";

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// PASSWORD_MIN_LENGTH viene de corporate-secrets/Environment/.env. La
// complejidad (mayus/minus/digito) es un minimo razonable propio, no un
// requisito explicito del proyecto -facil de endurecer despues sin tocar
// firmas de funciones.
export function assertPasswordPolicy(plain: string): void {
  const problems: string[] = [];

  if (plain.length < env.password.minLength) {
    problems.push(`debe tener al menos ${env.password.minLength} caracteres`);
  }
  if (!/[A-Z]/.test(plain)) problems.push("debe incluir al menos una mayuscula");
  if (!/[a-z]/.test(plain)) problems.push("debe incluir al menos una minuscula");
  if (!/[0-9]/.test(plain)) problems.push("debe incluir al menos un digito");

  if (problems.length > 0) {
    throw new BadRequestError("La contrasena no cumple la politica de seguridad", { problems });
  }
}
