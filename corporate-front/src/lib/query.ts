type QueryPrimitive = string | number | boolean;

// Arma un query-string a partir de un objeto plano (ListParams o un filtro
// puntual como {requestId}), descartando undefined/null. El parametro se
// tipa como "object", no Record<string, ...>: los DTOs reales que llegan
// aca son interfaces (ListParams, etc.) sin index signature propio, y
// Record<string, X> no las acepta estructuralmente aunque el shape calce
// -es una regla de TS sobre index signatures, no un problema real de los
// datos (ver "Index signature for type 'string' is missing" si se revierte
// este tipo).
export function toQuery(params?: object | null): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(
    (entry): entry is [string, QueryPrimitive] => entry[1] !== undefined && entry[1] !== null,
  );
  if (entries.length === 0) return "";
  const search = new URLSearchParams(entries.map(([key, value]) => [key, String(value)]));
  return `?${search.toString()}`;
}
