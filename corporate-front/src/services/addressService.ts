import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Address, AddressCreateInput, AddressUpdateInput } from "../types/address";

export const addressService = {
  // El backend exige exactamente uno de personId/businessPartnerId como filtro (400 si no viene ninguno).
  list: (filter: { personId: number } | { businessPartnerId: number }, params?: ListParams) =>
    apiFetch<Paginated<Address>>(`/addresses${toQuery({ ...filter, ...params })}`),

  getById: (id: number) => apiFetch<Address>(`/addresses/${id}`),

  create: (input: AddressCreateInput) => apiFetch<Address>("/addresses", { method: "POST", body: input }),

  update: (id: number, input: AddressUpdateInput) =>
    apiFetch<Address>(`/addresses/${id}`, { method: "PUT", body: input }),
};
