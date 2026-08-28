import type { PermissionKey } from "./auth";

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

// permissionKey ("recurso:accion", mismo formato que PermissionKey/
// REQUIRED_PERMISSIONS) en vez de permissionId: el backend (createMenuItem/
// updateMenuItem, menuItem.service.ts) lo resuelve al id numerico real
// buscando por resource+action -no hace falta conocer el id de antemano.
export interface MenuItemCreateInput {
  label: string;
  icon?: string;
  link?: string;
  parentId?: number;
  permissionKey?: PermissionKey;
  sortOrder?: number;
}

export type MenuItemUpdateInput = Partial<MenuItemCreateInput>;
