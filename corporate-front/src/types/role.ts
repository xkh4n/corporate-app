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

// Sin isActive: PUT /roles/:id lo rechaza (400). Habilitar/deshabilitar van
// por roleService.activate / roleService.deactivate.
export type RoleUpdateInput = Partial<Omit<RoleCreateInput, "isActive">>;
