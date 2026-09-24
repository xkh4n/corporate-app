import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DOWNLOADS_ROOT = path.join(__dirname, "../downloads");
const UPLOADS_ROOT = path.join(__dirname, "../uploads");

// Sufijo de los temporales de saveBuffer: nunca deben verse como documentos.
const TMP_SUFFIX = ".tmp";

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

// Guias de despacho de las devoluciones de activos: <codigo>.pdf, donde el
// codigo lo arma el servidor (library/assetReturnCode.ts), nunca el cliente.
export function getAssetReturnsFolder(): string {
  return path.join(UPLOADS_ROOT, "devoluciones");
}

// Respaldo de cada baja contable (plan 008): certificado notarial y fotos de
// los activos, en una carpeta por baja. Los nombres los genera el servidor.
export function getAssetWriteOffFolder(writeOffId: number): string {
  return path.join(UPLOADS_ROOT, "bajas", String(writeOffId));
}

// Borra la carpeta completa (descartar un borrador). Best-effort, como deleteIfExists.
export function deleteFolderIfExists(folder: string): void {
  try {
    fs.rmSync(folder, { recursive: true, force: true });
  } catch (err) {
    void import("./logger.js").then(({ logger }) => logger.warn({ err, folder }, "No se pudo borrar la carpeta"));
  }
}

// Escritura ATOMICA: se escribe a un temporal en la MISMA carpeta y se renombra. Las 3
// replicas comparten el volumen, y una lectura concurrente (sendFile de otra replica)
// nunca debe ver un archivo a medio escribir. rename es atomico dentro del mismo volumen.
export function saveBuffer(folder: string, filename: string, buffer: Buffer): string {
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, filename);
  // UUID (no pid+fecha): cada contenedor tiene su propio espacio de PIDs y suelen repetirse entre replicas.
  const tmpPath = `${filePath}.${randomUUID()}${TMP_SUFFIX}`;
  try {
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
  return filePath;
}

// Best-effort (igual criterio que copyIfExists): usado al re-subir una
// imagen con una extension distinta a la ya guardada, para no dejar el
// archivo viejo huerfano en disco.
export function deleteIfExists(folder: string, filename: string): void {
  // force:true no falla si el archivo ya no existe (otra replica pudo borrarlo entre medio). Cualquier otro
  // error (permisos, disco) se registra y se traga: es best-effort y no debe convertir una operacion ya
  // confirmada (p. ej. cancelar una devolucion) en un 500, ni ocultar el error original de quien limpia.
  try {
    fs.rmSync(path.join(folder, filename), { force: true });
  } catch (err) {
    // Import diferido: el logger exige variables de entorno al cargarse y este modulo se usa tambien en tests unitarios puros.
    void import("./logger.js").then(({ logger }) => logger.warn({ err, folder, filename }, "No se pudo borrar el archivo"));
  }
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
// puede haberse subido como .pdf, .jpg, etc.). El prefijo debe ir seguido de "." (la
// extension): un startsWith(prefix) a secas hacia que "OC-1" o "COT-123" casaran con
// "OC-10.pdf" o "COT-1234....pdf" y se adjuntara el archivo de OTRA orden o proveedor.
export function findFileByPrefix(folder: string, prefix: string): string | null {
  if (!fs.existsSync(folder)) return null;
  const match = fs.readdirSync(folder).find((name) => name.startsWith(`${prefix}.`) && !name.endsWith(TMP_SUFFIX));
  return match ?? null;
}

export function listFiles(folder: string): string[] {
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((name) => {
      if (name.endsWith(TMP_SUFFIX)) return false;
      try {
        return fs.statSync(path.join(folder, name)).isFile();
      } catch {
        // Borrado por otra replica entre readdir y stat.
        return false;
      }
    });
}

// requestNumber es seguro -generado por el sistema, formato controlado.
// nationalId y documentNumber (guia/factura/boleta) SON texto libre del
// usuario: siempre pasar por aca antes de usarlos en un nombre de archivo,
// para evitar separadores de ruta ("/", "\") o "..".
export function sanitizeFilenameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
