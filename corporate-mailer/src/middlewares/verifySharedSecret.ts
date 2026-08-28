import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../library/env";
import { readSecretFromEnv } from "../library/secrets";

const sharedSecret = readSecretFromEnv(env.sharedSecretFileVar);
const sharedSecretBuffer = Buffer.from(sharedSecret);

// Comparacion constant-time: "!==" sobre strings corta apenas encuentra el
// primer caracter distinto, filtrando por timing cuanto del secreto coincidio
// -riesgo bajo hoy (secreto de 64 caracteres aleatorios, unico cliente
// posible restringido a la red Docker "mailer-net"), pero es la practica
// estandar para cualquier comparacion de secretos (hallazgo de auditoria de
// seguridad 2026-08-07). Longitudes distintas se descartan antes de
// timingSafeEqual (exige mismo tamaño de buffer) -esto sí revela la longitud
// por early-return, pero es el mismo trade-off aceptado en toda comparacion
// de este tipo (ej. verificacion de firmas HMAC).
function safeCompare(a: Buffer, b: string): boolean {
  const bufB = Buffer.from(b);
  if (a.length !== bufB.length) return false;
  return timingSafeEqual(a, bufB);
}

// Segunda capa ademas del aislamiento de red (solo corporate-api puede
// alcanzar este contenedor por la red compartida "mailer-net"): este
// servicio manda correos de verdad, vale la pena no confiar unicamente en
// la topologia de red.
export function verifySharedSecret(req: Request, res: Response, next: NextFunction): void {
  const token = req.header("X-Mailer-Token");
  if (!token || !safeCompare(sharedSecretBuffer, token)) {
    res.status(401).json({ codigo: 401, message: "Token invalido" });
    return;
  }
  next();
}
