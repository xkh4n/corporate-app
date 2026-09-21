export interface PaginationParams {
  page: number;
  limit: number;
  search?: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  // Filtro server-side por status (ej. "APPROVED,IN_QUOTATION"), usado por
  // las pantallas del flujo de compras que necesitan ver solo un subconjunto
  // de estados. Server-side y no un .filter() en el cliente a proposito:
  // esas listas usan un limit fijo, un filtro client-side dejaria de mostrar
  // filas elegibles en silencio apenas hubiera mas de esa cantidad.
  status?: string[];
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
// Un offset fuera del rango de bigint de Postgres tumba la query con un 500.
const MAX_PAGE = 100_000;

// Aunque Sequelize/Mongoose ya escapan el nombre de columna en la posicion
// de "order" (no es vector de inyeccion -verificado revisando el query
// generator de ambos dialectos-), un sortBy con caracteres arbitrarios
// puede ser una columna inexistente y tumbar la query con un 500 evitable.
// Restringir a la forma de un identificador (letras/numeros/guion bajo) es
// defensa en profundidad barata (hallazgo de auditoria de seguridad
// 2026-08-07); no reemplaza un allowlist por recurso, que no se justifica
// hoy dado que no hay una via de explotacion real.
const SAFE_SORT_BY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Mismo criterio que SAFE_SORT_BY: un token que no calce con la forma de un
// status conocido (SCREAMING_SNAKE, ver PURCHASE_REQUEST_STATUSES) se
// descarta en silencio en vez de pasarlo tal cual a un Op.in -evita que un
// valor arbitrario en el query string llegue a la query.
const SAFE_STATUS_TOKEN = /^[A-Z_]{1,20}$/;

function toInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Acepta req.query (y opcionalmente req.body, para clientes que prefieran
// mandar los filtros en el body de un POST de busqueda) -mismo criterio que
// el ejemplo de referencia del usuario ("...req.query, ...req.body").
// allowedSortBy: lista permitida por endpoint. Con ella, un sortBy que no este en la
// lista (p. ej. una columna sensible como assets.value) cae al orden por defecto en
// vez de ordenar por ahi. maxLimit acota el limit por debajo del MAX_LIMIT global.
export interface PaginationOptions {
  allowedSortBy?: readonly string[];
  maxLimit?: number;
}

export function parsePaginationParams(
  source: Record<string, unknown>,
  defaultSortBy: string,
  defaultSortOrder: "asc" | "desc" = "asc",
  options: PaginationOptions = {},
): PaginationParams {
  const page = Math.min(MAX_PAGE, Math.max(1, toInt(source.page, 1)));
  const maxLimit = Math.min(MAX_LIMIT, options.maxLimit ?? MAX_LIMIT);
  const limit = Math.max(1, Math.min(maxLimit, toInt(source.limit, DEFAULT_LIMIT)));
  const rawSearch = typeof source.search === "string" ? source.search.trim() : "";
  const search = rawSearch.length > 0 ? rawSearch : undefined;
  const rawSortBy = typeof source.sortBy === "string" ? source.sortBy : "";
  const sortAllowed = SAFE_SORT_BY.test(rawSortBy) && (!options.allowedSortBy || options.allowedSortBy.includes(rawSortBy));
  const sortBy = sortAllowed ? rawSortBy : defaultSortBy;
  const sortOrder = source.sortOrder === "asc" || source.sortOrder === "desc" ? source.sortOrder : defaultSortOrder;
  const rawStatus = typeof source.status === "string" ? source.status : "";
  const statusTokens = rawStatus
    .split(",")
    .map((token) => token.trim())
    .filter((token) => SAFE_STATUS_TOKEN.test(token));
  const status = statusTokens.length > 0 ? statusTokens : undefined;
  return { page, limit, search, sortBy, sortOrder, status };
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
