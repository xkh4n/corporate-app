import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { City } from "../types/city";

export const cityService = {
  list: (params?: ListParams) => apiFetch<Paginated<City>>(`/cities${toQuery(params)}`),
  getById: (id: number) => apiFetch<City>(`/cities/${id}`),
};
