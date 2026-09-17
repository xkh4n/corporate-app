import fs from "node:fs";
import path from "node:path";

const DOWNLOADS_ROOT = path.join(__dirname, "../downloads");
const UPLOADS_ROOT = path.join(__dirname, "../uploads");

// Documentos de la solicitud de cotizacion (SOLCOT-<nationalId>.pdf, generado
// por el backend; COT-<nationalId>.<ext>, subido cuando el proveedor
// responde) -uno por proveedor cotizante, agrupados por solicitud.
export function getQuoteRequestFolder(requestNumber: string): string {
  return path.join(DOWNLOADS_ROOT, "solicitudes_cotizacion", requestNumber);
}

// Carpeta consolidada de la adquisicion ya autorizada: copia de la solicitud
// y cotizacion del proveedor ganador + autorizacion + documento de
// recepcion (guia/factura/boleta), todo agrupado por numero de solicitud.
export function getAcquisitionFolder(requestNumber: string): string {
  return path.join(UPLOADS_ROOT, "adquisiciones", requestNumber);
}

// Una sola imagen por producto (Mongo _id como nombre de archivo, ver
// attachProductImage en services/mongo/product.service.ts) -carpeta plana
// compartida, no una subcarpeta por producto: el propio nombre de archivo ya
// es unico.
export function getProductImagesFolder(): string {
  return path.join(UPLOADS_ROOT, "images", "products");
}

export function saveBuffer(folder: string, filename: string, buffer: Buffer): string {
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// Best-effort (igual criterio que copyIfExists): usado al re-subir una
// imagen con una extension distinta a la ya guardada, para no dejar el
// archivo viejo huerfano en disco.
export function deleteIfExists(folder: string, filename: string): void {
  const filePath = path.join(folder, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// Best-effort: si el archivo de origen no existe (ej. nunca se subio el
// comprobante de la cotizacion), no falla -solo no copia nada.
export function copyIfExists(srcFolder: string, destFolder: string, filename: string): void {
  const srcPath = path.join(srcFolder, filename);
  if (!fs.existsSync(srcPath)) return;
  fs.mkdirSync(destFolder, { recursive: true });
  fs.copyFileSync(srcPath, path.join(destFolder, filename));
}

// Ubica un archivo por prefijo sin conocer su extension (ej. "COT-12345678"
// puede haberse subido como .pdf, .jpg, etc.).
export function findFileByPrefix(folder: string, prefix: string): string | null {
  if (!fs.existsSync(folder)) return null;
  const match = fs.readdirSync(folder).find((name) => name.startsWith(prefix));
  return match ?? null;
}

export function listFiles(folder: string): string[] {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).filter((name) => fs.statSync(path.join(folder, name)).isFile());
}

// requestNumber es seguro -generado por el sistema, formato controlado.
// nationalId y documentNumber (guia/factura/boleta) SON texto libre del
// usuario: siempre pasar por aca antes de usarlos en un nombre de archivo,
// para evitar separadores de ruta ("/", "\") o "..".
export function sanitizeFilenameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
