import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Permission } from "../types/permission";

// Catalogo de solo lectura: los permisos los define el backend, no hay
// create/update/delete desde el front.
export const permissionService = {
  list: (params?: ListParams) => apiFetch<Paginated<Permission>>(`/permissions${toQuery(params)}`),
};
