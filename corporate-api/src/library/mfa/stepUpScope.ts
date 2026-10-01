import type { Request } from "express";
import { createHash } from "node:crypto";
import { UnauthorizedError } from "../errors";

// Identifica la sesion concreta a la que se ata un step-up (ver services/redis/mfa.service.ts): el id
// de la sesion de cookie o un hash del access token Bearer, en el mismo orden en que los resuelve
// authenticate.ts. El token nunca se guarda tal cual en Redis.
export function tokenScope(accessToken: string): string {
  return `tok:${createHash("sha256").update(accessToken).digest("hex").slice(0, 32)}`;
}

export function stepUpScope(req: Request): string {
  if (req.session?.user && req.sessionID) return `sid:${req.sessionID}`;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return tokenScope(header.slice("Bearer ".length).trim());
  throw new UnauthorizedError("Se requiere sesion o token de acceso");
}
