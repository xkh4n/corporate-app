import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { SafeUser, UserAccess, UserCreateInput, UserUpdateInput } from "../types/user";

export const userService = {
  list: (params?: ListParams) => apiFetch<Paginated<SafeUser>>(`/users${toQuery(params)}`),

  getById: (id: number) => apiFetch<SafeUser>(`/users/${id}`),

  getAccess: (id: number) => apiFetch<UserAccess>(`/users/${id}/access`),

  create: (input: UserCreateInput) => apiFetch<SafeUser>("/users", { method: "POST", body: input }),

  update: (id: number, input: UserUpdateInput) =>
    apiFetch<SafeUser>(`/users/${id}`, { method: "PATCH", body: input }),

  changePassword: (id: number, password: string) =>
    apiFetch<void>(`/users/${id}/password`, { method: "PATCH", body: { password } }),

  deactivate: (id: number) => apiFetch<void>(`/users/${id}`, { method: "DELETE" }),
};
