import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Country } from "../types/country";

export const countryService = {
  list: (params?: ListParams) => apiFetch<Paginated<Country>>(`/countries${toQuery(params)}`),
  getById: (id: number) => apiFetch<Country>(`/countries/${id}`),
};
