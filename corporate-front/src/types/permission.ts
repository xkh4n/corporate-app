// Espejo de corporate-api/src/models/postgres/permission.model.ts (PermissionAttributes).
// "access": permiso de pantalla (agrupador, plan 006) que incluye los
// permisos base de su vista.
export type PermissionAction = "create" | "read" | "update" | "delete" | "approve" | "activate" | "access";

export const ACCESS_ACTION: PermissionAction = "access";

// Forma reducida de un permiso incluido por un agrupador.
export interface IncludedPermission {
  id: number;
  resource: string;
  action: PermissionAction;
  description: string | null;
}

export interface Permission {
  id: number;
  resource: string;
  action: PermissionAction;
  description: string | null;
  createdAt: string;
  // Solo lo trae GET /permissions (vacio salvo en los "access"). Los
  // permisos de GET /roles/:id/permissions no lo incluyen.
  includedPermissions?: IncludedPermission[];
}

export interface PermissionCreateInput {
  resource: string;
  action: PermissionAction;
  description: string;
  // Solo para action "access": el backend responde 400 en cualquier otra.
  includedPermissionIds?: number[];
}
