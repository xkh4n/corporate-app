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
  // Desde el plan 006 las hojas con vista implementada usan su permiso de
  // pantalla "<slug>:access" (SCREEN_ACCESS_CATALOG en permission-catalog.ts),
  // que incluye los permisos base de la vista.
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
    permissionKey: "employee-onboarding:access",
    sortOrder: 10,
  },
  { label: "Cargos", icon: "IoLibrary", parentLabel: "Colaboradores", sortOrder: 10 },
  {
    label: "Nuevo Cargo",
    icon: "IoDocumentAttachOutline",
    link: "/employees/cargos",
    parentLabel: "Cargos",
    permissionKey: "position-creation:access",
    sortOrder: 10,
  },
  { label: "Previsión", icon: "IoShieldCheckmark", parentLabel: "Gerencia de Personas", sortOrder: 10 },
  {
    label: "Asignar AFP",
    icon: "IoWallet",
    link: "/employees/previsional/afp",
    parentLabel: "Previsión",
    permissionKey: "afp-assignment:access",
    sortOrder: 10,
  },
  {
    label: "Asignar Salud",
    icon: "IoMedkit",
    link: "/employees/previsional/salud",
    parentLabel: "Previsión",
    permissionKey: "health-plan-assignment:access",
    sortOrder: 20,
  },
  {
    label: "CCAF y Mutualidad",
    icon: "IoBusiness",
    link: "/company/previsional",
    parentLabel: "Previsión",
    permissionKey: "ccaf-mutual:access",
    sortOrder: 30,
  },
  { label: "Remuneraciones", icon: "IoCash", parentLabel: "Gerencia de Personas", sortOrder: 10 },
  {
    label: "Configuración de Remuneraciones",
    icon: "IoOptions",
    link: "/payroll/settings",
    parentLabel: "Remuneraciones",
    permissionKey: "payroll-configuration:access",
    sortOrder: 10,
  },
  { label: "Roles", icon: "IoLibrary", parentLabel: "Gerencia de Personas", sortOrder: 10 },

  {
    label: "Nuevo Rol",
    icon: "IoLaptop",
    link: "/roles/create",
    parentLabel: "Roles",
    permissionKey: "role-creation:access",
    sortOrder: 10,
  },
  {
    label: "Ver Rol",
    icon: "IoInformationCircleOutline",
    link: "/roles/read",
    parentLabel: "Roles",
    permissionKey: "role-view:access",
    sortOrder: 10,
  },
  { label: "Gerencia de TI", icon: "IoDesktop", sortOrder: 20 },
  { label: "Serv. Productivos", icon: "IoConstruct", parentLabel: "Gerencia de TI", sortOrder: 10 },
  { label: "Permisos", icon: "IoFingerPrint", parentLabel: "Serv. Productivos", sortOrder: 10 },

  {
    label: "Nuevo Permiso",
    icon: "IoGitPullRequest",
    link: "/permissions/create",
    parentLabel: "Permisos",
    permissionKey: "permission-creation:access",
    sortOrder: 10,
  },
  {
    label: "Ver Permisos",
    icon: "IoGitCompare",
    link: "/permissions/read",
    parentLabel: "Permisos",
    permissionKey: "permission-view:access",
    sortOrder: 10,
  },
  {
    label: "Modificar Permisos",
    icon: "IoHammer",
    link: "/permissions/update",
    parentLabel: "Permisos",
    permissionKey: "role-permission-assignment:access",
    sortOrder: 10,
  },
  {
    label: "Permisos de Pantalla",
    icon: "IoLayers",
    link: "/permissions/access",
    parentLabel: "Permisos",
    permissionKey: "access-permission-management:access",
    sortOrder: 15,
  },
  {
    label: "Deshabilitar Roles",
    icon: "IoBan",
    link: "/roles/deactivate",
    parentLabel: "Permisos",
    permissionKey: "role-deactivation:access",
    sortOrder: 20,
  },
  {
    label: "Habilitar Roles",
    icon: "IoCheckmarkCircle",
    link: "/roles/activate",
    parentLabel: "Permisos",
    permissionKey: "role-activation:access",
    sortOrder: 30,
  },

  { label: "Pantallas", icon: "IoDesktop", parentLabel: "Serv. Productivos", sortOrder: 10 },
  {
    label: "Ver Pantallas",
    icon: "IoList",
    link: "/menu-items/read",
    parentLabel: "Pantallas",
    permissionKey: "screen-view:access",
    sortOrder: 5,
  },
  {
    label: "Nueva Pantalla",
    icon: "IoDesktopOutline",
    link: "/menu-items/create",
    parentLabel: "Pantallas",
    permissionKey: "screen-creation:access",
    sortOrder: 10,
  },
  {
    label: "Asignar Permisos",
    icon: "IoDocumentLockOutline",
    link: "/menu-items/update",
    parentLabel: "Pantallas",
    permissionKey: "screen-permission-assignment:access",
    sortOrder: 10,
  },
  { label: "Adquisiciones", icon: "IoCart", parentLabel: "Serv. Productivos", sortOrder: 10 },

  { label: "Proveedores", icon: "IoBusiness", parentLabel: "Adquisiciones", sortOrder: 10 },
  {
    label: "Crear Proveedor",
    icon: "IoBriefcaseOutline",
    link: "/suppliers/create",
    parentLabel: "Proveedores",
    permissionKey: "supplier-creation:access",
    sortOrder: 10,
  },
  { label: "Compras", icon: "IoCart", parentLabel: "Adquisiciones", sortOrder: 20 },
  {
    label: "Solicitar Cotización",
    icon: "IoPricetagsOutline",
    link: "/quotes/request",
    parentLabel: "Compras",
    permissionKey: "quote-request:access",
    sortOrder: 30,
  },
  {
    label: "Cargar Cotizaciones",
    icon: "IoDocumentAttachOutline",
    link: "/quotes/upload",
    parentLabel: "Compras",
    permissionKey: "quote-upload:access",
    sortOrder: 40,
  },
  {
    label: "Enviar Orden de Compra",
    icon: "IoSendOutline",
    link: "/purchase-orders/send",
    parentLabel: "Compras",
    permissionKey: "purchase-order-sending:access",
    sortOrder: 70,
  },
  { label: "Productos", icon: "IoBasket", parentLabel: "Adquisiciones", sortOrder: 20 },
  {
    label: "Nuevo Producto",
    icon: "IoBagAddSharp",
    link: "/products/create",
    parentLabel: "Productos",
    permissionKey: "product-creation:access",
    sortOrder: 10,
  },
  {
    label: "Ver Productos",
    icon: "IoBagAddSharp",
    link: "/products/list",
    parentLabel: "Productos",
    permissionKey: "product-list:access",
    sortOrder: 20,
  },
  {
    label: "Recepcionar Mercadería",
    icon: "IoCubeOutline",
    link: "/goods-receipts/create",
    parentLabel: "Productos",
    permissionKey: "goods-receipt:access",
    sortOrder: 80,
  },
  {
    label: "Asignar Activos",
    icon: "IoPersonAddOutline",
    link: "/assets/assign",
    parentLabel: "Productos",
    permissionKey: "asset-assignment:access",
    sortOrder: 90,
  },
  {
    label: "Estado de Activos por Solicitud",
    icon: "IoListOutline",
    link: "/solicitudes/estado-activos",
    parentLabel: "Productos",
    permissionKey: "request-asset-status:access",
    sortOrder: 92,
  },
  {
    label: "Etiquetas de Activos",
    icon: "IoPricetagOutline",
    link: "/assets/labels",
    parentLabel: "Productos",
    permissionKey: "asset-labels:access",
    sortOrder: 95,
  },
  {
    label: "Kardex de Activos",
    icon: "IoCalculatorOutline",
    link: "/assets/kardex",
    parentLabel: "Productos",
    permissionKey: "asset-kardex-view:access",
    sortOrder: 100,
  },
  {
    label: "Toma de Inventario",
    icon: "IoClipboardOutline",
    link: "/inventory/counts",
    parentLabel: "Productos",
    permissionKey: "inventory-taking:access",
    sortOrder: 105,
  },
  {
    label: "Valorización de Activos",
    icon: "IoCashOutline",
    link: "/assets/valuation",
    parentLabel: "Productos",
    // :read (igual que el GET de la API y la pantalla): con :update solo, el item aparecia y la pantalla negaba el acceso.
    permissionKey: "asset-valuation-view:access",
    sortOrder: 110,
  },
  {
    label: "Devoluciones de Activos",
    icon: "IoReturnDownBackOutline",
    link: "/assets/returns",
    parentLabel: "Productos",
    permissionKey: "asset-return-management:access",
    sortOrder: 108,
  },
  {
    label: "Carga Masiva de Activos",
    icon: "IoCloudUploadOutline",
    link: "/assets/import",
    parentLabel: "Productos",
    // :read (igual que el GET de la API y la pantalla): subir e iniciar cargas exige ademas :create, que se asigna junto.
    permissionKey: "asset-bulk-import:access",
    sortOrder: 112,
  },

  {
    label: "Vincular Productos a Proveedor",
    icon: "IoLink",
    link: "/supplier-products/manage",
    parentLabel: "Productos",
    permissionKey: "supplier-product-linking:access",
    sortOrder: 25,
  },

  { label: "Categoria Productos", icon: "IoLibrary", parentLabel: "Adquisiciones", sortOrder: 30 },
  {
    label: "Nueva Categoria",
    icon: "IoLibraryOutline",
    link: "/category/create",
    parentLabel: "Categoria Productos",
    permissionKey: "category-creation:access",
    sortOrder: 10,
  },
  {
    label: "Ver Categorias",
    icon: "IoLocateOutline",
    link: "/category/view",
    parentLabel: "Categoria Productos",
    permissionKey: "category-view:access",
    sortOrder: 20,
  },
  {
    label: "Actualizar Categorias",
    icon: "IoColorWandOutline",
    link: "/category/update",
    parentLabel: "Categoria Productos",
    permissionKey: "category-update:access",
    sortOrder: 30,
  },

  { label: "Solicitudes", icon: "IoMailSharp", sortOrder: 30 },
  {
    label: "Nueva Solicitud",
    icon: "IoMailOpenOutline",
    link: "/tickets/create",
    parentLabel: "Solicitudes",
    permissionKey: "purchase-request-creation:access",
    sortOrder: 10,
  },
  {
    label: "Autorizar Solicitud",
    icon: "IoMailUnreadOutline",
    link: "/tickets/validate",
    parentLabel: "Solicitudes",
    permissionKey: "request-approval:access",
    sortOrder: 20,
  },
  {
    label: "Aprobar Cotización",
    icon: "IoCheckmarkDoneOutline",
    link: "/quotes/approve",
    parentLabel: "Solicitudes",
    permissionKey: "quote-approval:access",
    sortOrder: 50,
  },
  {
    label: "Adjuntar Orden de Compra",
    icon: "IoDocumentTextOutline",
    link: "/purchase-orders/attach",
    parentLabel: "Solicitudes",
    permissionKey: "purchase-order-attachment:access",
    sortOrder: 60,
  },
  // Service Desk (plan 009): mismos label/icono/link/orden que el usuario
  // creo desde Nueva Pantalla en Development (la siembra adopta esas filas por label).
  {
    label: "Generar Ticket",
    icon: "IoTicketOutline",
    link: "/generate-ticket",
    parentLabel: "Solicitudes",
    permissionKey: "generate-ticket:access",
    sortOrder: 10,
  },
  // Contabilidad > Gestion de Activos (plan 007). Mismos labels que el
  // usuario ya creo desde "Nueva Pantalla" en Development (la siembra hace
  // upsert por label y adopta esas filas); "Capitalizacion" va sin tilde,
  // igual que en la BD.
  { label: "Contabilidad", icon: "IoCashSharp", sortOrder: 30 },
  { label: "Gestión de Activos", icon: "IoDesktop", parentLabel: "Contabilidad", sortOrder: 10 },
  {
    label: "Clasificación Contable",
    icon: "IoGitBranchOutline",
    link: "/accounting/classification",
    parentLabel: "Gestión de Activos",
    permissionKey: "accounting-classification:access",
    sortOrder: 10,
  },
  {
    label: "Determinar Costo",
    icon: "IoCalculatorOutline",
    link: "/accounting/cost",
    parentLabel: "Gestión de Activos",
    permissionKey: "accounting-cost:access",
    sortOrder: 20,
  },
  {
    label: "Capitalizacion",
    icon: "IoCashOutline",
    link: "/accounting-capitalization",
    parentLabel: "Gestión de Activos",
    permissionKey: "accounting-capitalization:access",
    sortOrder: 30,
  },
  {
    label: "Depreciación",
    icon: "IoTrendingDownOutline",
    link: "/accounting/depreciation",
    parentLabel: "Gestión de Activos",
    permissionKey: "accounting-depreciation:access",
    sortOrder: 40,
  },
  {
    label: "Baja Contable",
    icon: "IoTrashBinOutline",
    link: "/accounting/write-off",
    parentLabel: "Gestión de Activos",
    permissionKey: "accounting-write-off:access",
    sortOrder: 50,
  },
  {
    label: "Política Contable de Activos",
    icon: "IoOptionsOutline",
    link: "/accounting/policy",
    parentLabel: "Gestión de Activos",
    permissionKey: "accounting-policy:access",
    sortOrder: 60,
  },

  // Serv. Productivos > Soporte (plan 009). "Soporte" y "Gestión de Tickets"
  // se crearon desde Nueva Pantalla en Development con estos mismos datos.
  { label: "Soporte", icon: "IoHammer", parentLabel: "Serv. Productivos", sortOrder: 10 },
  {
    label: "Gestión de Tickets",
    icon: "IoFootstepsOutline",
    link: "/support-services",
    parentLabel: "Soporte",
    permissionKey: "support-services:access",
    sortOrder: 10,
  },
  {
    label: "Configuración Service Desk",
    icon: "IoSettingsOutline",
    link: "/support-services/settings",
    parentLabel: "Soporte",
    permissionKey: "support-settings:access",
    sortOrder: 20,
  },
];

// Items que salieron de MENU_CATALOG pero que ya pueden existir en
// menu_items de un arranque anterior: seedMenuItems es aditivo (upsert por
// label), asi que sacarlos del array no alcanza -se desactivan explicitamente
// (isActive=false, mismo soft-delete que DELETE /menu-items/:id).
// "Asignar Autorización" (Personas > Roles, /roles/update) se reemplazo por
// Permisos > "Modificar Permisos" (/permissions/update) el 2026-09-23.
export const RETIRED_MENU_LABELS: string[] = ["Asignar Autorización"];
