// Espejo de corporate-api/src/models/postgres/permission.model.ts (PermissionAttributes).
export type PermissionAction = "create" | "read" | "update" | "delete" | "approve";

export interface Permission {
  id: number;
  resource: string;
  action: PermissionAction;
  description: string | null;
  createdAt: string;
}
