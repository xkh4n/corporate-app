import type { NextFunction, Request, Response } from "express";
import multer, { MulterError } from "multer";
import { AppError, BadRequestError } from "../library/errors";
import { sendOk } from "../library/response";
import { createConcurrencyGate } from "../library/concurrencyGate";
import { sanitizePdf } from "../library/pdfSanitizer";
import { uploadRateLimiter } from "./rateLimit";

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

// Carga masiva por CSV (plan 005): estos tipos SOLO se aceptan en las rutas que declaran kind "csv" y esas rutas
// no aceptan ningun otro. Windows suele declarar application/vnd.ms-excel para un .csv y algunos clientes text/plain.
const CSV_MIME_TYPES = new Set(["text/csv", "application/vnd.ms-excel", "text/plain"]);

// Un CSV es texto: UTF-8 valido, sin bytes nulos y con la cabecera esperada (serial_number). Es una verificacion
// barata para rechazar binarios disfrazados antes de parsear; la validacion de fondo la hace library/csvImport.ts.
function looksLikeImportCsv(buffer: Buffer): boolean {
  if (buffer.length === 0 || buffer.includes(0)) return false;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return false;
  }
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  return firstLine.toLowerCase().includes("serial_number");
}

// memoryStorage a proposito: el nombre final del archivo (SOLCOT-<nationalId>,
// COT-<nationalId>, etc.) depende de datos que recien se conocen despues de
// consultar la BD (nationalId del proveedor, requestNumber) -no del nombre
// original subido. El service escribe el buffer a disco el mismo, via
// library/documentStorage.ts, una vez resueltos esos datos.
//
// Un uploader por tamano maximo (la guia de despacho admite menos que el resto). Ademas del tamano se
// acota la forma del multipart (1 archivo, pocos campos): sin eso una request podia mandar cientos de
// partes pequenas.
const uploaders = new Map<string, multer.Multer>();

function getUploader(maxFileSizeBytes: number, kind: UploadKind): multer.Multer {
  const cacheKey = `${kind}:${maxFileSizeBytes}`;
  let uploader = uploaders.get(cacheKey);
  if (!uploader) {
    const allowed = kind === "csv" ? CSV_MIME_TYPES : ALLOWED_MIME_TYPES;
    uploader = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxFileSizeBytes, files: 1, fields: 10, parts: 12 },
      fileFilter: (_req, file, callback) => {
        if (!allowed.has(file.mimetype)) {
          callback(new BadRequestError(`Tipo de archivo no permitido: ${file.mimetype}`));
          return;
        }
        callback(null, true);
      },
    });
    uploaders.set(cacheKey, uploader);
  }
  return uploader;
}

// Subidas EN CURSO a la vez, por proceso: con memoryStorage cada una retiene hasta 2 x el tamano del
// archivo (los trozos + el buffer final). El limitador por ventana cuenta requests, no las simultaneas,
// asi que una rafaga paralela podia agotar los 512 MB del contenedor. Peor caso por replica:
// 8 x 2 x 15 MB = 240 MB.
const uploadGate = createConcurrencyGate({ maxTotal: 8, maxPerKey: 2 });

// Envuelve multer.single() para que un error de multer (tamano excedido,
// campo inesperado) llegue al errorHandler como BadRequestError -mismo
// formato {codigo, message} que el resto de la API. El chequeo de magic bytes va
// ACA (no en fileFilter): con memoryStorage, file.buffer todavia no existe cuando
// fileFilter corre -llega recien cuando multer termina de leer el stream completo.
// "document" (por defecto): PDF, imagenes y correos. "csv": solo CSV de carga masiva; una ruta acepta uno u otro.
export type UploadKind = "document" | "csv";

export interface UploadOptions {
  kind?: UploadKind;
  // Sanea el PDF con qpdf (library/pdfSanitizer.ts): rechaza contenido activo (JavaScript, Launch,
  // archivos incrustados...) y REEMPLAZA req.file.buffer por la reescritura de qpdf. Opt-in: los
  // adjuntos de compras (cotizaciones de proveedores, facturas) pueden traer formularios legitimos
  // y no se tocan.
  sanitizePdf?: boolean;
  // Tamano maximo del archivo (por defecto 15 MB).
  maxFileSizeBytes?: number;
}

export function uploadSingle(fieldName: string, options: UploadOptions = {}) {
  const kind = options.kind ?? "document";
  const middleware = getUploader(options.maxFileSizeBytes ?? MAX_FILE_SIZE_BYTES, kind).single(fieldName);
  const receive = (req: Request, res: Response, next: NextFunction): void => {
    middleware(req, res, (err: unknown) => {
      void handle(err);
    });

    async function handle(err: unknown): Promise<void> {
      if (err) {
        if (err instanceof MulterError) {
          next(new BadRequestError(`Error al subir el archivo: ${err.message}`));
          return;
        }
        next(err);
        return;
      }
      if (req.file) {
        const contentOk =
          kind === "csv" ? looksLikeImportCsv(req.file.buffer) : matchesRealContent(req.file.mimetype, req.file.buffer);
        if (!contentOk) {
          next(
            new BadRequestError(
              kind === "csv"
                ? "El archivo debe ser un CSV de texto en UTF-8 con la columna serial_number (en Excel: Guardar como «CSV UTF-8»)"
                : "El contenido del archivo no coincide con su tipo declarado",
            ),
          );
          return;
        }
      }
      if (options.sanitizePdf && req.file && req.file.mimetype === "application/pdf") {
        try {
          // Lo que se guarda es la reescritura de qpdf, no el archivo subido.
          req.file.buffer = await sanitizePdf(req.file.buffer);
          req.file.size = req.file.buffer.length;
        } catch (sanitizeErr) {
          next(sanitizeErr);
          return;
        }
      }
      next();
    }
  };
  // El limite de subidas corre ANTES de multer: una request rechazada nunca llega a
  // bufferear el archivo en memoria.
  return (req: Request, res: Response, next: NextFunction): void => {
    uploadRateLimiter(req, res, (limitErr?: unknown) => {
      if (limitErr) {
        next(limitErr);
        return;
      }
      // Tope de subidas simultaneas: se reserva el cupo ANTES de leer el archivo y se libera al terminar la
      // respuesta (o al cortarse la conexion).
      const release = uploadGate.tryAcquire(String(req.user?.userId ?? req.ip ?? "anon"));
      if (!release) {
        next(new AppError(429, "Hay demasiadas subidas en curso, intente nuevamente en unos segundos"));
        return;
      }
      res.once("close", release);
      receive(req, res, next);
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
