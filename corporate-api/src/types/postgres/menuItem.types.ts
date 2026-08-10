export interface MenuItemAttributes {
  id: number;
  label: string;
  icon: string | null;
  link: string | null;
  parentId: number | null;
  permissionId: number | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type MenuItemCreationAttributes = Pick<MenuItemAttributes, "label"> &
  Partial<Pick<MenuItemAttributes, "icon" | "link" | "parentId" | "permissionId" | "sortOrder">>;

export type MenuItemUpdateAttributes = Partial<
  Pick<MenuItemAttributes, "label" | "icon" | "link" | "parentId" | "permissionId" | "sortOrder">
>;

// Forma del arbol ya armado y podado por permisos (GET /auth/menu) -sin
// parentId/permissionId, esos son detalles internos del catalogo plano, no
// se exponen al cliente.
export interface MenuNode {
  id: number;
  label: string;
  icon: string | null;
  link: string | null;
  children: MenuNode[];
}
