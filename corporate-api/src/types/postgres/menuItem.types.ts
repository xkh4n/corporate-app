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

// permissionId NO forma parte del input: el cliente manda permissionKey
// ("recurso:accion", ver createMenuItemSchema) y createMenuItem/
// updateMenuItem (menuItem.service.ts) lo resuelven al id numerico real
// antes de escribir en MenuItemAttributes.
export type MenuItemCreationAttributes = Pick<MenuItemAttributes, "label"> &
  Partial<Pick<MenuItemAttributes, "icon" | "link" | "parentId" | "sortOrder">> & {
    permissionKey?: string;
  };

export type MenuItemUpdateAttributes = Partial<
  Pick<MenuItemAttributes, "label" | "icon" | "link" | "parentId" | "sortOrder">
> & {
  permissionKey?: string;
};

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
