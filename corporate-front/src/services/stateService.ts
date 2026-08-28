import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { State } from "../types/state";

export const stateService = {
  list: (params?: ListParams) => apiFetch<Paginated<State>>(`/states${toQuery(params)}`),
  getById: (id: number) => apiFetch<State>(`/states/${id}`),
};
