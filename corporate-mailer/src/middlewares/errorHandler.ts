import type { NextFunction, Request, Response } from "express";
import { logger } from "../library/logger";

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ codigo: 404, message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
}

// El envio de correo es lo unico que puede fallar de forma esperable aqui
// (SMTP caido, credenciales invalidas, etc.) -se responde 502 (este
// servicio actuo como gateway hacia el proveedor SMTP externo y ese
// upstream fallo), nunca 500, para que quien llama (corporate-api) pueda
// distinguir "mi request estaba mal" de "el proveedor de correo fallo".
// Excepcion: errores que YA traen su propio status 4xx (JSON malformado o
// body demasiado grande, ambos lanzados por express.json() antes de llegar
// al controller) no son un fallo de SMTP -se propagan tal cual, en vez de
// reetiquetarse como 502.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const status = getClientErrorStatus(err);
  if (status) {
    logger.warn({ err, path: req.originalUrl }, "Solicitud invalida");
    res.status(status).json({ codigo: status, message: "Solicitud invalida" });
    return;
  }

  logger.error({ err, path: req.originalUrl }, "Fallo al procesar el envio de correo");
  res.status(502).json({ codigo: 502, message: "No se pudo enviar el correo" });
}

function getClientErrorStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const status = "status" in err ? err.status : "statusCode" in err ? err.statusCode : null;
  return typeof status === "number" && status >= 400 && status < 500 ? status : null;
}
