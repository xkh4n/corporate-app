import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { MenuItem, MenuItemCreateInput, MenuItemUpdateInput } from "../types/menuItem";

export const menuItemService = {
  list: (params?: ListParams) => apiFetch<Paginated<MenuItem>>(`/menu-items${toQuery(params)}`),

  getById: (id: number) => apiFetch<MenuItem>(`/menu-items/${id}`),

  create: (input: MenuItemCreateInput) => apiFetch<MenuItem>("/menu-items", { method: "POST", body: input }),

  update: (id: number, input: MenuItemUpdateInput) =>
    apiFetch<MenuItem>(`/menu-items/${id}`, { method: "PUT", body: input }),

  // 409 si todavia tiene hijos activos -el backend lo resuelve, ApiError.status
  // ya trae el codigo, no hay manejo especial aca.
  deactivate: (id: number) => apiFetch<void>(`/menu-items/${id}`, { method: "DELETE" }),
};
