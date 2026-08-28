import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Position, PositionCreateInput, PositionUpdateInput } from "../types/position";

// id es ObjectId de Mongo (string), no number como en el resto de services.
export const positionService = {
  list: (params?: ListParams) => apiFetch<Paginated<Position>>(`/positions${toQuery(params)}`),
  getById: (id: string) => apiFetch<Position>(`/positions/${id}`),
  create: (body: PositionCreateInput) => apiFetch<Position>("/positions", { method: "POST", body }),
  update: (id: string, body: PositionUpdateInput) =>
    apiFetch<Position>(`/positions/${id}`, { method: "PUT", body }),
};
