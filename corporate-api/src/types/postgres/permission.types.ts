import type { PermissionAction } from "../../models/postgres/permission.model";

export interface PermissionAttributes {
  id: number;
  resource: string;
  action: PermissionAction;
  description: string | null;
  createdAt: Date;
}

export type { PermissionAction };
