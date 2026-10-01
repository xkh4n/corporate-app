import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { env } from "./env";
import { readSecretFromEnv } from "./secrets";
import type { JwtPayload } from "../types/auth.types";

// Secrets HMAC leidos una sola vez al levantar el proceso (Docker secret,
// no rota en caliente: rotarlo implica reiniciar el contenedor, mismo
// criterio que el resto de las contrasenas de este proyecto).
const accessSecret = readSecretFromEnv(env.jwt.accessSecretFileVar);
const refreshSecret = readSecretFromEnv(env.jwt.refreshSecretFileVar);

type BasePayload = Omit<JwtPayload, "type" | "jti">;

// HS256 explicito en sign/verify: hallazgo de auditoria de seguridad
// 2026-08-17 -con un secreto string, jsonwebtoken hoy restringe "verify" a
// la familia HS* por defecto (nada de la clasica confusion de algoritmo
// HS/RS), pero eso es comportamiento IMPLICITO de la libreria, no algo
// visible en este archivo, y queda a un upgrade de dependencia de distancia
// de cambiar en silencio. Fijarlo aca no depende de ese default.
const JWT_ALGORITHM = "HS256";

// jti aleatorio tambien en el access token (plan 017): dos tokens emitidos en el mismo segundo con
// el mismo payload salian identicos, y el step-up de MFA se ata al token (library/mfa/stepUpScope.ts).
export function signAccessToken(payload: BasePayload): string {
  const body: JwtPayload = { ...payload, type: "access", jti: randomUUID() };
  return jwt.sign(body, accessSecret, { expiresIn: env.jwt.accessTtlSeconds, algorithm: JWT_ALGORITHM });
}

export function signRefreshToken(payload: BasePayload, jti: string): string {
  const body: JwtPayload = { ...payload, type: "refresh", jti };
  return jwt.sign(body, refreshSecret, { expiresIn: env.jwt.refreshTtlSeconds, algorithm: JWT_ALGORITHM });
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, accessSecret, { algorithms: [JWT_ALGORITHM] }) as unknown as JwtPayload;
  if (decoded.type !== "access") {
    throw new jwt.JsonWebTokenError("Tipo de token invalido, se esperaba 'access'");
  }
  return decoded;
}

export function verifyRefreshToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, refreshSecret, { algorithms: [JWT_ALGORITHM] }) as unknown as JwtPayload;
  if (decoded.type !== "refresh") {
    throw new jwt.JsonWebTokenError("Tipo de token invalido, se esperaba 'refresh'");
  }
  return decoded;
}
