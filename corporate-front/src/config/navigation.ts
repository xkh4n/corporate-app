import type { PermissionKey } from "../types/auth";

export interface NavItem {
  path: string;
  label: string;
  // Sin permission: solo requiere sesion (ver Dashboard). Con permission:
  // el item se oculta en el sidebar y la ruta responde 403 si no se tiene
  // (PermissionRoute), salvo "admin" (bypass, ver AuthContext.can).
  permission?: PermissionKey;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

// Fuente unica del menu: Sidebar y el router en App.tsx leen de aca, asi que
// agregar un modulo nuevo es una linea. El permiso de cada item es el mismo
// resource:action que gatea su endpoint en corporate-api (ver
// databases/permission-catalog.ts) -mantenerlos sincronizados a mano por
// ahora, no hay codegen desde el catalogo todavia.
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Compras",
    items: [
      { path: "/purchase-requests", label: "Solicitudes de compra", permission: "purchase-requests:read" },
      { path: "/quotes", label: "Cotizaciones", permission: "quotes:read" },
      { path: "/authorizations", label: "Autorizaciones", permission: "authorizations:read" },
      { path: "/purchase-orders", label: "Ordenes de compra", permission: "purchase-orders:read" },
      { path: "/goods-receipts", label: "Recepciones", permission: "goods-receipts:read" },
    ],
  },
  {
    title: "Maestros",
    items: [
      { path: "/suppliers", label: "Proveedores", permission: "suppliers:read" },
      { path: "/customers", label: "Clientes", permission: "customers:read" },
      { path: "/products", label: "Productos", permission: "products:update" },
      { path: "/assets", label: "Activos", permission: "assets:read" },
      { path: "/employees", label: "Colaboradores", permission: "employees:read" },
    ],
  },
  {
    title: "Administracion",
    items: [
      { path: "/admin/users", label: "Usuarios", permission: "users:read" },
      { path: "/admin/roles", label: "Roles y permisos", permission: "roles:read" },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);
