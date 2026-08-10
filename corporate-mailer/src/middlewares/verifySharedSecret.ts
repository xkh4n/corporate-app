import type { NextFunction, Request, Response } from "express";
import { env } from "../library/env";
import { readSecretFromEnv } from "../library/secrets";

const sharedSecret = readSecretFromEnv(env.sharedSecretFileVar);

// Segunda capa ademas del aislamiento de red (solo corporate-api puede
// alcanzar este contenedor por la red compartida "mailer-net"): este
// servicio manda correos de verdad, vale la pena no confiar unicamente en
// la topologia de red.
export function verifySharedSecret(req: Request, res: Response, next: NextFunction): void {
  const token = req.header("X-Mailer-Token");
  if (token !== sharedSecret) {
    res.status(401).json({ codigo: 401, message: "Token invalido" });
    return;
  }
  next();
}
