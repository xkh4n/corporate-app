// Sobre de respuesta del backend (corporate-api/src/library/response.ts).
export interface ApiEnvelope<T> {
  codigo: number;
  message: string;
  data: T;
}

export interface PaginationMeta {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

// Query params comunes a los endpoints de listado (ver library/pagination.ts
// en corporate-api). Los services que ademas exigen un filtro puntual
// (ej. requestId en purchase-request-lines) lo agregan aparte, no aca
// -ese filtro es obligatorio, no una opcion de paginado.
export interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  // Coma-separado (ej. "APPROVED,IN_QUOTATION"), ver library/pagination.ts
  // en corporate-api. Se declara como string generico (no un union de
  // PurchaseRequestStatus) porque ListParams es comun a todos los listados
  // paginados, no solo a solicitudes de compra.
  status?: string;
}

// Forma estandar de error (errorHandler.ts). El rate limiter del login es la
// unica excepcion: responde 429 con {error: string}, sin "codigo" ni
// "message" -ver ApiError.fromResponse en lib/apiClient.ts, que normaliza
// ambos casos a la misma forma en el cliente.
export interface ApiErrorBody {
  codigo: number;
  message: string;
  details?: unknown;
}
