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
  { label: "Previsión", icon: "IoShieldCheckmark", parentLabel: "Gerencia de Personas", sortOrder: 10 },
  {
    label: "Asignar AFP",
    icon: "IoWallet",
    link: "/employees/previsional/afp",
    parentLabel: "Previsión",
    permissionKey: "previsional-profiles:update",
    sortOrder: 10,
  },
  {
    label: "Asignar Salud",
    icon: "IoMedkit",
    link: "/employees/previsional/salud",
    parentLabel: "Previsión",
    permissionKey: "previsional-profiles:update",
    sortOrder: 20,
  },
  {
    label: "CCAF y Mutualidad",
    icon: "IoBusiness",
    link: "/company/previsional",
    parentLabel: "Previsión",
    permissionKey: "previred-settings:update",
    sortOrder: 30,
  },
  { label: "Remuneraciones", icon: "IoCash", parentLabel: "Gerencia de Personas", sortOrder: 10 },
  {
    label: "Configuración de Remuneraciones",
    icon: "IoOptions",
    link: "/payroll/settings",
    parentLabel: "Remuneraciones",
    permissionKey: "payroll-settings:update",
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
  { label: "Compras", icon: "IoCart", parentLabel: "Adquisiciones", sortOrder: 20 },
  {
    label: "Solicitar Cotización",
    icon: "IoPricetagsOutline",
    link: "/quotes/request",
    parentLabel: "Compras",
    permissionKey: "quotes:create",
    sortOrder: 30,
  },
  {
    label: "Cargar Cotizaciones",
    icon: "IoDocumentAttachOutline",
    link: "/quotes/upload",
    parentLabel: "Compras",
    permissionKey: "quotes:create",
    sortOrder: 40,
  },
  {
    label: "Enviar Orden de Compra",
    icon: "IoSendOutline",
    link: "/purchase-orders/send",
    parentLabel: "Compras",
    permissionKey: "quotes:create",
    sortOrder: 70,
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
  {
    label: "Recepcionar Mercadería",
    icon: "IoCubeOutline",
    link: "/goods-receipts/create",
    parentLabel: "Productos",
    permissionKey: "goods-receipts:create",
    sortOrder: 80,
  },
  {
    label: "Asignar Activos",
    icon: "IoPersonAddOutline",
    link: "/assets/assign",
    parentLabel: "Productos",
    permissionKey: "asset-movements:create",
    sortOrder: 90,
  },
  {
    label: "Estado de Activos por Solicitud",
    icon: "IoListOutline",
    link: "/solicitudes/estado-activos",
    parentLabel: "Productos",
    permissionKey: "purchase-requests:read",
    sortOrder: 92,
  },
  {
    label: "Etiquetas de Activos",
    icon: "IoPricetagOutline",
    link: "/assets/labels",
    parentLabel: "Productos",
    permissionKey: "assets:read",
    sortOrder: 95,
  },
  {
    label: "Kardex de Activos",
    icon: "IoCalculatorOutline",
    link: "/assets/kardex",
    parentLabel: "Productos",
    permissionKey: "asset-kardex:read",
    sortOrder: 100,
  },
  {
    label: "Toma de Inventario",
    icon: "IoClipboardOutline",
    link: "/inventory/counts",
    parentLabel: "Productos",
    permissionKey: "inventory-counts:read",
    sortOrder: 105,
  },
  {
    label: "Valorización de Activos",
    icon: "IoCashOutline",
    link: "/assets/valuation",
    parentLabel: "Productos",
    // :read (igual que el GET de la API y la pantalla): con :update solo, el item aparecia y la pantalla negaba el acceso.
    permissionKey: "asset-valuation:read",
    sortOrder: 110,
  },
  {
    label: "Devoluciones de Activos",
    icon: "IoReturnDownBackOutline",
    link: "/assets/returns",
    parentLabel: "Productos",
    permissionKey: "asset-returns:read",
    sortOrder: 108,
  },
  {
    label: "Carga Masiva de Activos",
    icon: "IoCloudUploadOutline",
    link: "/assets/import",
    parentLabel: "Productos",
    // :read (igual que el GET de la API y la pantalla): subir e iniciar cargas exige ademas :create, que se asigna junto.
    permissionKey: "asset-imports:read",
    sortOrder: 112,
  },

  {
    label: "Vincular Productos a Proveedor",
    icon: "IoLink",
    link: "/supplier-products/manage",
    parentLabel: "Productos",
    permissionKey: "supplier-products:create",
    sortOrder: 25,
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
  {
    label: "Aprobar Cotización",
    icon: "IoCheckmarkDoneOutline",
    link: "/quotes/approve",
    parentLabel: "Solicitudes",
    permissionKey: "authorizations:create",
    sortOrder: 50,
  },
  {
    label: "Adjuntar Orden de Compra",
    icon: "IoDocumentTextOutline",
    link: "/purchase-orders/attach",
    parentLabel: "Solicitudes",
    permissionKey: "purchase-orders:update",
    sortOrder: 60,
  },
];
