import type { NextFunction, Request, Response } from "express";

// Limite de requests EN VUELO simultaneas, no de requests por ventana de
// tiempo: el riesgo real (hallazgo de auditoria de seguridad 2026-09-17) es
// memoria, no volumen -cada request puede pesar hasta 20mb (adjuntos en
// base64), y sin este limite una rafaga de ~13 requests concurrentes de
// tamano maximo satura el memory limit de 256M del contenedor de produccion
// (compose.prod.yml) antes de que cualquier limite por-ventana llegue a
// activarse. Complementa pool:true/maxConnections del transporter SMTP (ver
// library/mailer.ts): este middleware limita cuantos requests HTTP estan
// siendo procesados a la vez, el pool limita cuantas conexiones SMTP salen
// a la vez.
const MAX_CONCURRENT_REQUESTS = 5;
let inFlight = 0;

export function limitConcurrency(_req: Request, res: Response, next: NextFunction): void {
  if (inFlight >= MAX_CONCURRENT_REQUESTS) {
    res.status(429).json({
      codigo: 429,
      message: "Demasiadas solicitudes de envio en curso, reintentar en unos segundos",
    });
    return;
  }

  inFlight += 1;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    inFlight -= 1;
  };
  res.on("finish", release);
  res.on("close", release);

  next();
}
