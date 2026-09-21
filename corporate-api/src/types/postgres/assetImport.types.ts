import type { ProductType } from "../mongo/product.types";
import type { ImportIssue, ImportStatusCode } from "../../library/csvImport";

// Carga masiva de activos por CSV (plan 005).

// Fila ya resuelta contra Mongo/MSSQL/Postgres: es lo que se guarda en Redis y lo que procesa el worker, para no
// volver a consultar Mongo y MSSQL al reanudar.
export interface ResolvedImportRow {
  row: number;
  serialNumber: string;
  productId: string;
  productType: ProductType;
  costCenterId: number;
  statusCode: ImportStatusCode;
  holderUserId: number | null;
  warrantyExpiresAt: string | null;
}

// FAILED: el trabajo se abandono tras demasiados intentos por errores de infraestructura (base caida, etc.); las filas
// ya creadas quedan y el resultado se puede descargar.
export type ImportJobStatus = "VALIDATED" | "RUNNING" | "DONE" | "CANCELLED" | "FAILED";

// Cabecera del trabajo (hash `meta` en Redis). Todos los valores viajan como strings en Redis; este es el
// objeto ya tipado.
export interface ImportJobMeta {
  id: string;
  status: ImportJobStatus;
  ownerUserId: number;
  filename: string;
  // Filas de datos del CSV, las que pasaron la validacion y las que no.
  totalRows: number;
  validRows: number;
  invalidRows: number;
  // Posicion (indice en las filas validas) de la proxima fila a procesar.
  cursor: number;
  ok: number;
  failed: number;
  // Veces que un worker tomo el trabajo: > 1 significa que se reanudo (una caida, un reinicio o un resume manual).
  attempts: number;
  // Fila (indice en las filas validas) que se estaba procesando cuando se cayo el worker, o -1.
  inflight: number;
  // Verdadero si se iniciaron solo las filas validas de un archivo con errores.
  skipInvalid: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type ImportRowResult =
  | { ok: true; tag: string; adopted?: boolean }
  | { ok: false; error: string };

export interface ImportValidationReport {
  jobId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  issues: ImportIssue[];
}

export interface ImportActor {
  userId: number;
  isAdmin: boolean;
}
