// Espejo de corporate-api/src/types/postgres/menuItem.types.ts (MenuNode).
// Sin permissionId: el arbol que devuelve GET /auth/menu ya viene podado por
// el backend, el front no re-evalua permisos sobre el menu.
export interface MenuNode {
  id: number;
  label: string;
  icon: string | null;
  link: string | null;
  children: MenuNode[];
}

export interface MenuResponse {
  menu: MenuNode[];
}
