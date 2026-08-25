import type { NextFunction, Request, Response } from "express";
import multer, { MulterError } from "multer";
import { BadRequestError } from "../library/errors";
import { sendOk } from "../library/response";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

// Extension segura para el archivo GUARDADO, derivada del mimetype ya
// validado -nunca de file.originalname (el nombre que manda el cliente es
// texto libre no confiable, ver library/documentStorage.ts/consumidores de
// este modulo: antes usaban path.extname(originalname), lo que permitia
// subir un binario declarando "application/pdf" con nombre "cosa.html" y
// que ese sufijo terminara literal en el archivo archivado).
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "message/rfc822": ".eml",
  "application/vnd.ms-outlook": ".msg",
};

// Verifica el contenido REAL del archivo contra su mimetype declarado (magic
// bytes) -el Content-Type de una parte multipart es un valor que el cliente
// controla libremente, multer nunca lo valida contra el contenido. Sin esto,
// cualquiera con permiso de "crear" podia subir un binario arbitrario
// pasando el filtro de fileFilter con solo declarar el Content-Type correcto
// (hallazgo de auditoria de seguridad 2026-08-07). "message/rfc822" (.eml)
// es texto plano sin firma binaria -se acepta con una heuristica best-effort
// (sin bytes nulos + al menos un header RFC822 reconocible al inicio) en vez
// de una firma exacta, que no existe para ese formato.
function matchesRealContent(mimetype: string, buffer: Buffer): boolean {
  switch (mimetype) {
    case "application/pdf":
      return buffer.subarray(0, 5).toString("latin1") === "%PDF-";
    case "image/jpeg":
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case "image/png":
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "application/vnd.ms-outlook":
      // Firma OLE/Compound File Binary (formato real de un .msg).
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    case "message/rfc822": {
      const headBytes = buffer.subarray(0, 2000);
      if (headBytes.includes(0)) return false;
      const head = headBytes.toString("utf-8");
      return /^(From|Return-Path|Received|Delivered-To|MIME-Version|Subject|Date|Message-ID|To):/im.test(
        head,
      );
    }
    default:
      return false;
  }
}

const ALLOWED_MIME_TYPES = new Set(Object.keys(EXTENSION_BY_MIME_TYPE));

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
// que tirar el MulterError sin convertir. El chequeo de magic bytes va ACA
// (no en fileFilter): con memoryStorage, file.buffer todavia no existe
// cuando fileFilter corre -llega recien cuando multer termina de leer el
// stream completo, que es este callback.
export function uploadSingle(fieldName: string) {
  const middleware = upload.single(fieldName);
  return (req: Request, res: Response, next: NextFunction): void => {
    middleware(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof MulterError) {
          next(new BadRequestError(`Error al subir el archivo: ${err.message}`));
          return;
        }
        next(err);
        return;
      }
      if (req.file && !matchesRealContent(req.file.mimetype, req.file.buffer)) {
        next(new BadRequestError("El contenido del archivo no coincide con su tipo declarado"));
        return;
      }
      next();
    });
  };
}

// Extension segura para el archivo guardado (ver EXTENSION_BY_MIME_TYPE):
// usar SIEMPRE esto en los *.service.ts que archivan el adjunto, nunca
// path.extname(file.originalname).
export function getSafeExtension(file: Express.Multer.File): string {
  return EXTENSION_BY_MIME_TYPE[file.mimetype] ?? ".pdf";
}

// Factory para los endpoints "POST /:id/attachment" de quotes/authorizations/
// goods-receipts/purchase-orders: los controllers repetian el mismo
// try/catch/BadRequestError/sendOk, difiriendo solo en la funcion de servicio
// y el mensaje de exito. Los *services* (attachQuoteDocument/
// attachAuthorizationDocument/attachGoodsReceiptDocument/
// attachPurchaseOrderDocument) NO se unifican -sus cadenas de resolucion de
// entidades son genuinamente distintas, solo comparten estas 3 lineas finales.
// userId es OPCIONAL y va tercero: los primeros 3 usos (quote/authorization/
// goods-receipt) no lo necesitan y siguen compilando con su firma de 2
// argumentos tal cual (TS permite pasar una funcion con MENOS parametros
// donde se espera una con mas, el argumento extra simplemente se ignora en
// runtime) -solo attachPurchaseOrderDocument lo usa, para poder actualizar
// purchase_requests.updated_by al flipear el status a OC_GENERATED.
export function makeAttachmentHandler(
  attachFn: (id: number, file: Express.Multer.File, userId?: number) => Promise<string>,
  successMessage: string,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) throw new BadRequestError("Debe adjuntar un archivo (campo 'file')");
      const filename = await attachFn(Number(req.params.id), req.file, req.user?.userId);
      sendOk(res, { filename }, successMessage, 201);
    } catch (err) {
      next(err);
    }
  };
}
