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

// Forma estandar de error (errorHandler.ts). El rate limiter del login es la
// unica excepcion: responde 429 con {error: string}, sin "codigo" ni
// "message" -ver ApiError.fromResponse en lib/apiClient.ts, que normaliza
// ambos casos a la misma forma en el cliente.
export interface ApiErrorBody {
  codigo: number;
  message: string;
  details?: unknown;
}
