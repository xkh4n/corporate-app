import type { MenuNode } from "../types/menu";

export interface MenuLink {
  link: string;
  label: string;
}

// Recorre todo el arbol (no solo las hojas: un nodo puede tener link Y
// children a la vez segun el esquema del backend). Usado tanto para generar
// las rutas de modulo (AppRoutes) como los accesos directos del dashboard.
export function flattenMenuLinks(nodes: MenuNode[]): MenuLink[] {
  return nodes.flatMap((node) => [
    ...(node.link ? [{ link: node.link, label: node.label }] : []),
    ...flattenMenuLinks(node.children),
  ]);
}
