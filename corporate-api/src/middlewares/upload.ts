import type { NextFunction, Request, Response } from "express";
import multer, { MulterError } from "multer";
import { BadRequestError } from "../library/errors";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "message/rfc822",
  "application/vnd.ms-outlook",
]);

// memoryStorage a proposito: el nombre final del archivo (SOLCOT-<nationalId>,
// COT-<nationalId>, etc.) depende de datos que recien se conocen despues de
// consultar la BD (nationalId del proveedor, requestNumber) -no del nombre
// original subido. El service escribe el buffer a disco el mismo, via
// library/documentStorage.ts, una vez resueltos esos datos.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(new BadRequestError(`Tipo de archivo no permitido: ${file.mimetype}`));
      return;
    }
    callback(null, true);
  },
});

// Envuelve multer.single() para que un error de multer (tamano excedido,
// campo inesperado) llegue al errorHandler como BadRequestError -mismo
// formato {codigo, message} que el resto de la API, en vez del 500 generico
// que tirar el MulterError sin convertir.
export function uploadSingle(fieldName: string) {
  const middleware = upload.single(fieldName);
  return (req: Request, res: Response, next: NextFunction): void => {
    middleware(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof MulterError) {
        next(new BadRequestError(`Error al subir el archivo: ${err.message}`));
        return;
      }
      next(err);
    });
  };
}
