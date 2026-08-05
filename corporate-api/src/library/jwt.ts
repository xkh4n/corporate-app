import jwt from "jsonwebtoken";
import { env } from "./env";
import { readSecretFromEnv } from "./secrets";
import type { JwtPayload } from "../types/auth.types";

// Secrets HMAC leidos una sola vez al levantar el proceso (Docker secret,
// no rota en caliente: rotarlo implica reiniciar el contenedor, mismo
// criterio que el resto de las contrasenas de este proyecto).
const accessSecret = readSecretFromEnv(env.jwt.accessSecretFileVar);
const refreshSecret = readSecretFromEnv(env.jwt.refreshSecretFileVar);

type BasePayload = Omit<JwtPayload, "type" | "jti">;

export function signAccessToken(payload: BasePayload): string {
  const body: JwtPayload = { ...payload, type: "access" };
  return jwt.sign(body, accessSecret, { expiresIn: env.jwt.accessTtlSeconds });
}

export function signRefreshToken(payload: BasePayload, jti: string): string {
  const body: JwtPayload = { ...payload, type: "refresh", jti };
  return jwt.sign(body, refreshSecret, { expiresIn: env.jwt.refreshTtlSeconds });
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, accessSecret) as unknown as JwtPayload;
  if (decoded.type !== "access") {
    throw new jwt.JsonWebTokenError("Tipo de token invalido, se esperaba 'access'");
  }
  return decoded;
}

export function verifyRefreshToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, refreshSecret) as unknown as JwtPayload;
  if (decoded.type !== "refresh") {
    throw new jwt.JsonWebTokenError("Tipo de token invalido, se esperaba 'refresh'");
  }
  return decoded;
}
