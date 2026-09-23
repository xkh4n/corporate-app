import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { IncludedPermission, Permission, PermissionCreateInput } from "../types/permission";

// El catalogo base lo siembra el backend (permission-catalog.ts); create da
// de alta permisos nuevos en caliente, sin recrear contenedores. La
// asignacion a roles vive en roleService (/roles/:id/permissions).
// Includes: permisos base de un agrupador "access" (plan 006).
export const permissionService = {
  list: (params?: ListParams) => apiFetch<Paginated<Permission>>(`/permissions${toQuery(params)}`),

  create: (input: PermissionCreateInput) => apiFetch<Permission>("/permissions", { method: "POST", body: input }),

  getIncludes: (id: number) => apiFetch<IncludedPermission[]>(`/permissions/${id}/includes`),

  addInclude: (id: number, permissionId: number) =>
    apiFetch<IncludedPermission[]>(`/permissions/${id}/includes`, { method: "POST", body: { permissionId } }),

  removeInclude: (id: number, includedId: number) =>
    apiFetch<void>(`/permissions/${id}/includes/${includedId}`, { method: "DELETE" }),
};
