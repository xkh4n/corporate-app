// Espejo de corporate-api/src/models/postgres/role.model.ts (RoleAttributes).
export interface Role {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoleCreateInput {
  name: string;
  description?: string;
  isActive?: boolean;
}

export type RoleUpdateInput = Partial<RoleCreateInput>;
