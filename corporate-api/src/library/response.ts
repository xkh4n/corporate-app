import type { Response } from "express";
import type { PaginationMeta } from "./pagination";

// Misma forma para exito Y error (ver library/middlewares/errorHandler.ts):
// {codigo, message, data | details} -evita que el frontend tenga que manejar
// una forma para listados, otra para items sueltos y una tercera para
// errores.
export function sendOk<T>(res: Response, data: T, message: string, statusCode = 200): void {
  res.status(statusCode).json({ codigo: statusCode, message, data });
}

export function sendList<T>(
  res: Response,
  items: T[],
  pagination: PaginationMeta,
  message: string,
): void {
  res.status(200).json({ codigo: 200, message, data: { items, pagination } });
}

export function sendNoContent(res: Response): void {
  res.status(204).send();
}
