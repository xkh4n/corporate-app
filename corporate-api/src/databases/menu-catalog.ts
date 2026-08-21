export interface MenuCatalogEntry {
  label: string;
  icon?: string;
  link?: string;
  // Referencia al padre por label (clave estable del catalogo), no por id
  // -los ids se resuelven en seedMenuItems (seed.ts) a medida que cada fila
  // se inserta, por eso el padre siempre tiene que aparecer ANTES que sus
  // hijos en este array.
  parentLabel?: string;
  // "recurso:accion" (mismo formato que permissionKey en menuItem.controller.ts),
  // resuelto contra el catalogo de permissions al sembrar. Los nodos
  // "carpeta" no llevan permissionKey: su visibilidad se deriva de tener al
  // menos un hijo alcanzable (ver getMenuTreeForRole, menuItem.service.ts).
  permissionKey?: string;
  sortOrder: number;
}

// Espejo del arbol de navegacion armado a mano en desarrollo (menu_items),
// para que una instalacion nueva arranque con algo navegable en vez de una
// tabla vacia -ver seedMenuItems. label es la clave estable (UNIQUE en la
// tabla desde esta migracion, ver postgres/migrate.ts).
//
// Una sola diferencia contra la data real de desarrollo: "Actualizar
// Categorias" (/category/update) hoy vive SIN permissionKey -sin eso, solo
// "admin" puede verla (un nodo hoja sin permiso nunca es "reachable" para
// nadie mas, ver getMenuTreeForRole). Se le asigna "product-categories:update"
// aca, que es el permiso que ya exige esa ruta en el backend
// (productCategory.routes.ts) -si la intencion real era dejarla admin-only,
// hay que sacar esta linea.
export const MENU_CATALOG: MenuCatalogEntry[] = [
  { label: "Gerencia de Personas", icon: "IoAccessibility", sortOrder: 10 },
  { label: "Colaboradores", icon: "IoPeople", parentLabel: "Gerencia de Personas", sortOrder: 10 },
  {
    label: "Nuevo Ingreso",
    icon: "IoPersonAdd",
    link: "/employees/create",
    parentLabel: "Colaboradores",
    permissionKey: "employees:create",
    sortOrder: 10,
  },
  { label: "Cargos", icon: "IoLibrary", parentLabel: "Colaboradores", sortOrder: 10 },
  {
    label: "Nuevo Cargo",
    icon: "IoDocumentAttachOutline",
    link: "/employees/cargos",
    parentLabel: "Cargos",
    permissionKey: "employees:create",
    sortOrder: 10,
  },
  { label: "Roles", icon: "IoLibrary", parentLabel: "Gerencia de Personas", sortOrder: 10 },

  {
    label: "Nuevo Rol",
    icon: "IoLaptop",
    link: "/roles/create",
    parentLabel: "Roles",
    permissionKey: "roles:create",
    sortOrder: 10,
  },
  {
    label: "Ver Rol",
    icon: "IoInformationCircleOutline",
    link: "/roles/read",
    parentLabel: "Roles",
    permissionKey: "roles:read",
    sortOrder: 10,
  },
  {
    label: "Asignar Autorización",
    icon: "IoLink",
    link: "/roles/update",
    parentLabel: "Roles",
    permissionKey: "roles:update",
    sortOrder: 10,
  },
  { label: "Gerencia de TI", icon: "IoDesktop", sortOrder: 20 },
  { label: "Serv. Productivos", icon: "IoConstruct", parentLabel: "Gerencia de TI", sortOrder: 10 },
  { label: "Permisos", icon: "IoFingerPrint", parentLabel: "Serv. Productivos", sortOrder: 10 },

  {
    label: "Nuevo Permiso",
    icon: "IoGitPullRequest",
    link: "/permision/create",
    parentLabel: "Permisos",
    permissionKey: "permissions:create",
    sortOrder: 10,
  },
  {
    label: "Ver Permisos",
    icon: "IoGitCompare",
    link: "/permision/read",
    parentLabel: "Permisos",
    permissionKey: "permissions:read",
    sortOrder: 10,
  },
  {
    label: "Modificar Permisos",
    icon: "IoHammer",
    link: "/permision/update",
    parentLabel: "Permisos",
    permissionKey: "permissions:update",
    sortOrder: 10,
  },

  { label: "Pantallas", icon: "IoDesktop", parentLabel: "Serv. Productivos", sortOrder: 10 },
  {
    label: "Nueva Pantalla",
    icon: "IoDesktopOutline",
    link: "/menu-items/create",
    parentLabel: "Pantallas",
    permissionKey: "menu-items:create",
    sortOrder: 10,
  },
  {
    label: "Asignar Permisos",
    icon: "IoDocumentLockOutline",
    link: "/menu-items/update",
    parentLabel: "Pantallas",
    permissionKey: "menu-items:update",
    sortOrder: 10,
  },
  { label: "Adquisiciones", icon: "IoCart", parentLabel: "Serv. Productivos", sortOrder: 10 },

  { label: "Proveedores", icon: "IoBusiness", parentLabel: "Adquisiciones", sortOrder: 10 },
  {
    label: "Crear Proveedor",
    icon: "IoBriefcaseOutline",
    link: "/suppliers/create",
    parentLabel: "Proveedores",
    permissionKey: "suppliers:create",
    sortOrder: 10,
  },

  { label: "Productos", icon: "IoBasket", parentLabel: "Adquisiciones", sortOrder: 20 },
  {
    label: "Nuevo Producto",
    icon: "IoBagAddSharp",
    link: "/products/create",
    parentLabel: "Productos",
    permissionKey: "products:create",
    sortOrder: 10,
  },
  {
    label: "Ver Productos",
    icon: "IoBagAddSharp",
    link: "/products/list",
    parentLabel: "Productos",
    permissionKey: "products:read",
    sortOrder: 20,
  },

  { label: "Categoria Productos", icon: "IoLibrary", parentLabel: "Adquisiciones", sortOrder: 30 },
  {
    label: "Nueva Categoria",
    icon: "IoLibraryOutline",
    link: "/category/create",
    parentLabel: "Categoria Productos",
    permissionKey: "product-categories:create",
    sortOrder: 10,
  },
  {
    label: "Ver Categorias",
    icon: "IoLocateOutline",
    link: "/category/view",
    parentLabel: "Categoria Productos",
    permissionKey: "product-categories:read",
    sortOrder: 20,
  },
  {
    label: "Actualizar Categorias",
    icon: "IoColorWandOutline",
    link: "/category/update",
    parentLabel: "Categoria Productos",
    permissionKey: "product-categories:update",
    sortOrder: 30,
  },

  { label: "Solicitudes", icon: "IoMailSharp", sortOrder: 30 },
  {
    label: "Nueva Solicitud",
    icon: "IoMailOpenOutline",
    link: "/tickets/create",
    parentLabel: "Solicitudes",
    permissionKey: "purchase-requests:create",
    sortOrder: 10,
  },
  {
    label: "Autorizar Solicitud",
    icon: "IoMailUnreadOutline",
    link: "/tickets/validate",
    parentLabel: "Solicitudes",
    permissionKey: "purchase-requests:approve",
    sortOrder: 20,
  },
];
