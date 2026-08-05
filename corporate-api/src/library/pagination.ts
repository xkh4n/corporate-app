export interface PaginationParams {
  page: number;
  limit: number;
  search?: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

export interface PaginationMeta {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 10000;

function toInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Acepta req.query (y opcionalmente req.body, para clientes que prefieran
// mandar los filtros en el body de un POST de busqueda) -mismo criterio que
// el ejemplo de referencia del usuario ("...req.query, ...req.body").
export function parsePaginationParams(
  source: Record<string, unknown>,
  defaultSortBy: string,
  defaultSortOrder: "asc" | "desc" = "asc",
): PaginationParams {
  const page = Math.max(1, toInt(source.page, 1));
  const limit = Math.max(1, Math.min(MAX_LIMIT, toInt(source.limit, DEFAULT_LIMIT)));
  const rawSearch = typeof source.search === "string" ? source.search.trim() : "";
  const search = rawSearch.length > 0 ? rawSearch : undefined;
  const sortBy = typeof source.sortBy === "string" && source.sortBy.length > 0 ? source.sortBy : defaultSortBy;
  const sortOrder = source.sortOrder === "asc" || source.sortOrder === "desc" ? source.sortOrder : defaultSortOrder;
  return { page, limit, search, sortBy, sortOrder };
}

export function getOffset(params: PaginationParams): number {
  return (params.page - 1) * params.limit;
}

export function buildPaginationMeta(params: PaginationParams, total: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / params.limit));
  return {
    currentPage: params.page,
    totalPages,
    totalItems: total,
    itemsPerPage: params.limit,
    hasNextPage: params.page < totalPages,
    hasPrevPage: params.page > 1,
  };
}
