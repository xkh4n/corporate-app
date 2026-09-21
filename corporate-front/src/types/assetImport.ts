// Carga masiva de activos por CSV (API /asset-imports).

export type ImportJobStatus = "VALIDATED" | "RUNNING" | "DONE" | "CANCELLED" | "FAILED";

export interface ImportIssue {
  // Número de fila como se ve en una planilla (la cabecera es la 1).
  row: number;
  column: string;
  message: string;
}

// Respuesta de subir el archivo: se valida completo sin escribir nada; el `jobId` sirve para iniciar la carga.
export interface ImportValidationReport {
  jobId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  issues: ImportIssue[];
}

export interface ImportJobMeta {
  id: string;
  status: ImportJobStatus;
  ownerUserId: number;
  filename: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  // Filas válidas ya procesadas.
  cursor: number;
  ok: number;
  failed: number;
  attempts: number;
  skipInvalid: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ImportJobState {
  meta: ImportJobMeta;
  pending: number;
  issues: ImportIssue[];
  issuesTotal: number;
}
