import type { NextFunction, Request, Response } from "express";
import { AppError } from "../library/errors";
import { logger } from "../library/logger";

export function notFoundHandler(req: Request, res: Response): void {
  res
    .status(404)
    .json({ codigo: 404, message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
}

// Misma forma {codigo, message, ...} que las respuestas exitosas (ver
// library/response.ts): el frontend no necesita un caso especial para
// errores, solo revisa "codigo".
//
// 4 parametros a proposito: es lo que hace que Express la reconozca como
// error-handling middleware (debe ser la ULTIMA en la cadena de app.use()).
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.originalUrl }, err.message);
    } else {
      logger.warn({ path: req.originalUrl }, err.message);
    }
    res.status(err.statusCode).json({ codigo: err.statusCode, message: err.message, details: err.details });
    return;
  }

  logger.error({ err, path: req.originalUrl }, "Error no controlado");
  res.status(500).json({ codigo: 500, message: "Error interno del servidor" });
}
