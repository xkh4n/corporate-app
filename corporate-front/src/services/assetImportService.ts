import { apiFetch, apiFetchBlob } from "../lib/apiClient";
import type { ImportJobMeta, ImportJobState, ImportValidationReport } from "../types/assetImport";

export const assetImportService = {
  // Sube y VALIDA el CSV (multipart, campo "file") sin crear ningún activo. Exige asset-imports:create.
  validate: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<ImportValidationReport>("/asset-imports", { method: "POST", body: form });
  },
  // Inicia la carga (202): un proceso del servidor la procesa fila a fila. skipInvalid = cargar solo las filas válidas.
  start: (jobId: string, skipInvalid: boolean) =>
    apiFetch<ImportJobMeta>(`/asset-imports/${encodeURIComponent(jobId)}/start${skipInvalid ? "?skipInvalid=true" : ""}`, { method: "POST" }),
  // Retoma una carga en curso que quedó sin proceso (el servidor lo hace solo en ~1 minuto; esto es para no esperar).
  resume: (jobId: string) => apiFetch<ImportJobMeta>(`/asset-imports/${encodeURIComponent(jobId)}/resume`, { method: "POST" }),
  cancel: (jobId: string) => apiFetch<ImportJobMeta>(`/asset-imports/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }),
  // Exige asset-imports:read; solo el dueño de la carga o un administrador.
  status: (jobId: string) => apiFetch<ImportJobState>(`/asset-imports/${encodeURIComponent(jobId)}`),
  // CSV directo (no el sobre {codigo,message,data}) con el resultado de cada fila.
  downloadResult: (jobId: string) => apiFetchBlob(`/asset-imports/${encodeURIComponent(jobId)}/result`),
};
