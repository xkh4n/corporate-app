import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Role, RoleCreateInput, RoleUpdateInput } from "../types/role";
import type { Permission } from "../types/permission";

export const roleService = {
  list: (params?: ListParams) => apiFetch<Paginated<Role>>(`/roles${toQuery(params)}`),

  getById: (id: number) => apiFetch<Role>(`/roles/${id}`),

  create: (input: RoleCreateInput) => apiFetch<Role>("/roles", { method: "POST", body: input }),

  update: (id: number, input: RoleUpdateInput) => apiFetch<Role>(`/roles/${id}`, { method: "PUT", body: input }),

  deactivate: (id: number) => apiFetch<void>(`/roles/${id}`, { method: "DELETE" }),

  getPermissions: (id: number) => apiFetch<Permission[]>(`/roles/${id}/permissions`),

  setPermissions: (id: number, permissionIds: number[]) =>
    apiFetch<Permission[]>(`/roles/${id}/permissions`, { method: "PUT", body: { permissionIds } }),

  addPermission: (id: number, permissionId: number) =>
    apiFetch<Permission[]>(`/roles/${id}/permissions`, { method: "POST", body: { permissionId } }),

  removePermission: (id: number, permissionId: number) =>
    apiFetch<void>(`/roles/${id}/permissions/${permissionId}`, { method: "DELETE" }),
};
