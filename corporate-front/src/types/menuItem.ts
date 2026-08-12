// Espejo de corporate-api/src/models/postgres/menuItem.model.ts (MenuItemAttributes).
// Catalogo plano de administracion (/menu-items), distinto de MenuNode en
// menu.ts: ese es el arbol ya podado por permisos que devuelve GET /auth/menu
// para armar la navegacion; este es el CRUD crudo sobre la tabla completa.
export interface MenuItem {
  id: number;
  label: string;
  icon: string | null;
  link: string | null;
  parentId: number | null;
  permissionId: number | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MenuItemCreateInput {
  label: string;
  icon?: string;
  link?: string;
  parentId?: number;
  permissionId?: number;
  sortOrder?: number;
}

export type MenuItemUpdateInput = Partial<MenuItemCreateInput>;
