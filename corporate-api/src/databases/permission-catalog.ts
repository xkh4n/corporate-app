import type { PermissionAction } from "../models/postgres/permission.model";

export interface PermissionCatalogEntry {
  resource: string;
  action: PermissionAction;
  description: string;
  // Si es true, el seed se lo asigna tambien al rol "user" (ademas de
  // "admin"), preservando el comportamiento de hoy: estos endpoints estan
  // abiertos a cualquier autenticado ("flujo operativo del dia a dia", ver
  // comentarios historicos en los *.routes.ts). Si es false/omitido, solo
  // "admin" lo tiene por defecto -un rol nuevo (ej. "adquisiciones",
  // "contabilidad") nace sin ninguno de estos y hay que asignarselos
  // explicitamente via PUT /roles/:id/permissions.
  grantToUser?: boolean;
}

// Catalogo BASE de permisos: sembrado en databases/seed.ts (seedPermissions)
// y consumido por authorize(resource, action) en cada *.routes.ts. Los
// permisos que gatea codigo del backend van aca (el router los necesita
// existir desde el primer arranque); los que solo gatean pantallas creadas
// en caliente (menu_items) se dan de alta via POST /permissions ("Nuevo
// Permiso"), sin tocar este archivo ni recrear contenedores. El seed es
// aditivo (ON CONFLICT (resource,action) DO UPDATE description): nunca borra
// los permisos creados por API.
export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  // Roles y permisos: gestion de acceso, admin-only por definicion.
  { resource: "roles", action: "read", description: "Consultar roles" },
  { resource: "roles", action: "create", description: "Crear roles" },
  { resource: "roles", action: "update", description: "Editar roles y sus permisos" },
  { resource: "roles", action: "delete", description: "Desactivar roles" },
  // Reactivar un rol desactivado (PATCH /roles/:id/activate): exige ademas
  // "roles:update" -ver role.routes.ts. Separado de update para poder
  // otorgarlo solo a usuarios puntuales.
  { resource: "roles", action: "activate", description: "Habilitar roles" },

  { resource: "permissions", action: "create", description: "Crear Permiso" },
  { resource: "permissions", action: "read", description: "Ver Permiso" },
  // Asignar/quitar permisos a un rol (GET/PUT/POST/DELETE
  // /roles/:id/permissions, ver role.routes.ts).
  { resource: "permissions", action: "update", description: "Asignar permisos a roles" },
  { resource: "permissions", action: "delete", description: "Eliminar Permiso" },

  // Catalogo de menu de navegacion: admin-only por el mismo motivo que
  // roles -expone labels/estructura real de funcionalidades del sistema,
  // no es metadata inocua como el catalogo de permissions. El arbol PODADO
  // por permisos del usuario logueado (GET /auth/menu) no exige ninguno de
  // estos, solo sesion (ver auth.routes.ts).
  { resource: "menu-items", action: "read", description: "Consultar catalogo de menu" },
  { resource: "menu-items", action: "create", description: "Crear items de menu" },
  { resource: "menu-items", action: "update", description: "Editar items de menu" },
  { resource: "menu-items", action: "delete", description: "Desactivar items de menu" },

  // PII: personas y usuarios, admin-only de punta a punta (igual que hoy).
  { resource: "persons", action: "create", description: "Crear personas" },
  { resource: "persons", action: "read", description: "Consultar personas" },
  { resource: "persons", action: "update", description: "Editar personas" },
  { resource: "persons", action: "delete", description: "Desactivar personas" },
  { resource: "users", action: "create", description: "Crear usuarios" },
  { resource: "users", action: "read", description: "Consultar usuarios" },
  { resource: "users", action: "update", description: "Editar usuarios (incluye password)" },
  { resource: "users", action: "delete", description: "Desactivar usuarios" },

  // Cotizaciones previsionales (nomina Previred). Todo admin-only por defecto:
  // el perfil trae el plan de isapre y el numero de FUN de cada colaborador.
  { resource: "previsional-institutions", action: "read", description: "Consultar AFP, salud, CCAF y mutualidades" },
  { resource: "previsional-profiles", action: "read", description: "Consultar la afiliacion previsional de un colaborador" },
  { resource: "previsional-profiles", action: "update", description: "Asignar AFP y salud a un colaborador" },
  { resource: "previred-settings", action: "read", description: "Consultar la CCAF y mutual de la empresa" },
  { resource: "previred-settings", action: "update", description: "Definir la CCAF y mutual de la empresa" },

  // Remuneraciones. Sueldo base y gratificacion de cada colaborador son datos
  // sensibles: admin-only por defecto, igual que el perfil previsional.
  { resource: "employee-contracts", action: "read", description: "Consultar contratos y sueldo de un colaborador" },
  { resource: "employee-contracts", action: "create", description: "Crear el contrato (sueldo y gratificacion) de un colaborador" },
  { resource: "payroll-settings", action: "read", description: "Consultar el sistema de gratificacion de la empresa" },
  { resource: "payroll-settings", action: "update", description: "Definir el sistema de gratificacion de la empresa" },
  { resource: "payroll-parameters", action: "read", description: "Consultar parametros de remuneraciones (IMM)" },
  { resource: "payroll-parameters", action: "update", description: "Registrar parametros de remuneraciones (IMM)" },

  // Maestros/config: admin-only por defecto (create/update).
  { resource: "business-partners",action: "read",description: "Consultar terceros",grantToUser: true,},
  { resource: "business-partners", action: "create", description: "Crear terceros" },
  { resource: "business-partners", action: "update", description: "Editar terceros" },
  
  { resource: "cost-centers", action: "create", description: "Crear centros de costo" },
  { resource: "cost-centers", action: "update", description: "Editar centros de costo" },
  { resource: "cost-centers", action: "read", description: "Listar centros de costo" },
  
  { resource: "suppliers", action: "read", description: "Consultar proveedores", grantToUser: true },
  { resource: "suppliers", action: "create", description: "Crear proveedores" },
  { resource: "suppliers", action: "update", description: "Editar proveedores" },
  
  { resource: "supplier-service-types",action: "create",description: "Crear tipos de servicio de proveedor",},
  { resource: "supplier-service-types",action: "update",description: "Editar tipos de servicio de proveedor",},
  { resource: "supplier-service-types",action: "read",description: "Listar tipos de servicio de proveedor",},
  
  { resource: "supplier-delivery-terms",action: "create",description: "Crear condiciones de entrega de proveedor",},
  { resource: "supplier-delivery-terms",action: "read",description: "Listar condiciones de entrega de proveedor",},
  { resource: "supplier-delivery-terms",action: "update",description: "Editar condiciones de entrega de proveedor",},
  
  { resource: "supplier-products",action: "read",description: "Consultar vinculos producto-proveedor",grantToUser: true,},
  { resource: "supplier-products",action: "create",description: "Vincular productos a un proveedor",},
  { resource: "supplier-products",action: "delete",description: "Desvincular productos de un proveedor",},
  
  { resource: "supplier-contacts",action: "read",description: "Consultar contactos de proveedor",grantToUser: true,},
  { resource: "supplier-contacts", action: "create", description: "Crear contactos de proveedor" },
  { resource: "supplier-contacts", action: "update", description: "Editar contactos de proveedor" },
  { resource: "supplier-contacts", action: "delete", description: "Eliminar contactos de proveedor" },
  
  { resource: "customers", action: "read", description: "Consultar clientes", grantToUser: true },
  { resource: "customers", action: "create", description: "Crear clientes" },
  { resource: "employees", action: "create", description: "Crear colaboradores" },
  // PII (via la persona asociada): admin-only por defecto, mismo criterio
  // que persons:read -no lleva grantToUser, corrige el hallazgo de
  // auditoria donde /employees quedaba abierto a cualquier autenticado.
  { resource: "employees", action: "read", description: "Consultar colaboradores" },
  { resource: "employees", action: "update", description: "Editar colaboradores" },

  { resource: "products", action: "create", description: "Crear productos" },
  // grantToUser: CreateRequest.tsx llama productService.list() para el
  // selector de productos al crear una solicitud de compra -mismo flujo
  // operativo que purchase-request-lines:create, sin el "user" base no
  // podria ni empezar a cargar una solicitud. El Product model no expone
  // PII/precio/costo (solo catalogo basico), asi que el riesgo de dejarlo
  // abierto es bajo -corrige el hallazgo de auditoria (GET /products sin
  // authorize()) sin repetir la revocacion admin-only que si aplico a
  // purchase-requests:read (ese SI exponia PII).
  { resource: "products", action: "read", description: "Listar productos", grantToUser: true },
  { resource: "products", action: "update", description: "Editar productos" },
  { resource: "products", action: "delete", description: "Desactivar productos" },

  { resource: "product-categories", action: "create", description: "Crear categorias de producto" },
  { resource: "product-categories", action: "update", description: "Editar categorias de producto" },
  { resource: "product-categories", action: "read", description: "Listar categorias de producto", grantToUser: true },
  
  { resource: "asset-statuses", action: "create", description: "Crear estados de activo" },
  { resource: "asset-statuses", action: "update", description: "Editar estados de activo" },
  { resource: "asset-statuses", action: "read", description: "Listar estados de activo" },

  // Flujo operativo de compras/activos: hoy abierto a cualquier autenticado
  // -se preserva para "user", pero ahora se puede restringir por rol nuevo.
  { resource: "addresses", action: "read", description: "Consultar direcciones", grantToUser: true },
  { resource: "addresses", action: "create", description: "Crear direcciones", grantToUser: true },
  { resource: "addresses", action: "update", description: "Editar direcciones", grantToUser: true },

  { resource: "purchase-requests",action: "create",description: "Crear solicitudes de compra",grantToUser: true,},
  // PII (requester/beneficiary via PersonModel completo: RUT, email,
  // telefono, fecha nacimiento): admin-only por defecto, mismo criterio que
  // employees:read -corrige el hallazgo de auditoria donde list()/getById()
  // exponian PII cruzando departamentos a cualquier autenticado con el rol
  // "user" base. Revocado explicitamente del rol "user" ya sembrado, ver
  // seedPermissions() en seed.ts (el seed de permisos es aditivo, no
  // alcanza con sacar el flag aca). Sin esto, AttachPurchaseOrder.tsx/
  // SendPurchaseOrder.tsx/ReceiveGoods.tsx/ApproveQuote.tsx dejan de poder
  // refrescar la solicitud tras cada paso -hay que crear un rol dedicado
  // (ej. "compras") y otorgarle este permiso explicitamente por
  // PUT /roles/:id/permissions.
  { resource: "purchase-requests",action: "read",description: "Consultar solicitudes de compra",},
  { resource: "purchase-requests",action: "update",description: "Editar solicitudes de compra (datos, no el estado)",grantToUser: true,},
  // Separado de "update" a proposito: aprobar/rechazar el estado de una
  // solicitud es una accion mas sensible que editar sus datos -mismo
  // criterio de segregacion de funciones que la regla de negocio en
  // authorization.service.ts (el solicitante no puede autorizar su propia
  // compra). No se otorga a "user" por defecto: solo admin, hasta que se
  // asigne explicitamente a un rol "aprobador".
  { resource: "purchase-requests",action: "approve",description: "Aprobar o rechazar el estado de una solicitud de compra",},
  // Sin endpoint todavia (no existe DELETE /purchase-requests) -reservado
  // para cuando se agregue cancelar/eliminar una solicitud.
  { resource: "purchase-requests",action: "delete",description: "Eliminar solicitudes de compra",},

  { resource: "purchase-request-lines",action: "read",description: "Consultar lineas de solicitud",grantToUser: true,},
  { resource: "purchase-request-lines",action: "create",description: "Crear lineas de solicitud",grantToUser: true,},
  { resource: "purchase-request-lines",action: "update",description: "Editar lineas de solicitud",grantToUser: true,},

  { resource: "quotes", action: "read", description: "Consultar cotizaciones", grantToUser: true },
  { resource: "quotes", action: "create", description: "Crear cotizaciones", grantToUser: true },
  { resource: "quotes", action: "approve", description: "Validar cotizaciones", grantToUser: true },

  { resource: "authorizations",action: "read",description: "Consultar autorizaciones",grantToUser: true,},
  { resource: "authorizations", action: "create", description: "Autorizar compras", grantToUser: true },

  { resource: "purchase-orders",action: "read",description: "Consultar ordenes de compra",grantToUser: true,},
  { resource: "purchase-orders",action: "create",description: "Crear ordenes de compra",grantToUser: true,},
  { resource: "purchase-orders",action: "update",description: "Editar ordenes de compra (incluye adjuntar la OC en PDF)",grantToUser: true,},

  { resource: "goods-receipts",action: "read",description: "Consultar recepciones de mercaderia",grantToUser: true,},
  { resource: "goods-receipts",action: "create",description: "Registrar recepciones de mercaderia",grantToUser: true,},

  { resource: "assets", action: "read", description: "Consultar activos", grantToUser: true },
  { resource: "assets", action: "update", description: "Editar activos", grantToUser: true },

  { resource: "asset-movements",action: "read",description: "Consultar movimientos de activos",grantToUser: true,},
  { resource: "asset-movements",action: "create",description: "Registrar movimientos de activos (asignar/mover)",grantToUser: true,},
  // Plan 012: dar de baja es aparte de asignar (deja el Kardex en cero). Sin grantToUser.
  { resource: "asset-decommissions", action: "create", description: "Dar de baja activos (deja el Kardex en cero)" },

  // Kardex de valorizacion contable: admin-only por defecto (sin
  // grantToUser), encaja con el caso de uso de rol "contabilidad" separado
  // de "adquisiciones" que ya se planteo para el RBAC granular.
  { resource: "asset-kardex", action: "read", description: "Consultar el kardex de valorizacion de activos" },
  { resource: "asset-kardex", action: "create", description: "Registrar asientos manuales de kardex (ajuste/baja)" },

  // Toma de inventario fisica. Admin-only por defecto (sin grantToUser): "create"
  // ademas DA DE ALTA activos nuevos (con tag) al levantar equipos que no
  // existen en el sistema, asi que el admin lo asigna a mano al rol del auditor.
  { resource: "inventory-counts", action: "read", description: "Consultar tomas de inventario y sus reportes" },
  { resource: "inventory-counts", action: "create", description: "Iniciar tomas de inventario e ingresar equipos (crea activos nuevos)" },
  { resource: "inventory-counts", action: "update", description: "Editar equipos de una toma abierta y cerrar la toma" },

  // Valorizacion posterior a la toma (Adquisiciones TI): asigna valor por primera
  // vez a activos sin valor y escribe su asiento de alta en el Kardex. Admin-only
  // por defecto (sin grantToUser): el admin lo asigna al rol de Adquisiciones TI.
  { resource: "asset-valuation", action: "read", description: "Consultar activos pendientes de valorizacion" },
  { resource: "asset-valuation", action: "update", description: "Asignar valor a activos que no lo tienen (genera asiento de kardex)" },

  // Devolucion de activos a Adquisiciones TI con guia de despacho. Admin-only por
  // defecto (sin grantToUser): "create" = solicitante (arma la devolucion, adjunta
  // la guia, la envia y la cancela; los activos pasan a MOVE_TO_RETURNED) y
  // "update" = recepcion en Adquisiciones (los activos pasan a RETURNED). El admin
  // los asigna por rol.
  { resource: "asset-returns", action: "read", description: "Consultar devoluciones de activos y sus guias de despacho" },
  { resource: "asset-returns", action: "create", description: "Solicitar devoluciones de activos: armarlas, adjuntar la guia, enviarlas o cancelarlas" },
  { resource: "asset-returns", action: "update", description: "Recibir en Adquisiciones los activos de una devolucion" },

  // Carga masiva de activos desde un CSV (solo altas). Admin-only por defecto (sin grantToUser): "create" = validar el
  // archivo, iniciar, reanudar y cancelar la carga (IMPLICA crear activos y asignarlos a cualquier usuario activo, sin
  // pasar por asset-movements: darlo solo a quien deba cargar inventario); "read" = consultar el estado y descargar el
  // resultado (la pantalla y el menu se gatean con "read": asignar ambos juntos; los GET aceptan cualquiera de los dos).
  // Cada carga solo la ve su dueno o un admin.
  { resource: "asset-imports", action: "read", description: "Consultar el estado y el resultado de las cargas masivas de activos" },
  { resource: "asset-imports", action: "create", description: "Cargar activos en lote desde un CSV (crea activos y los asigna a usuarios): validarlo, iniciar la carga, reanudarla o cancelarla" },

  // Gestion contable de activos (plan 007, ciclo ITIL). Admin-only por
  // defecto: capitalizar, cerrar y anular cierres escriben en el Kardex.
  { resource: "asset-accounting", action: "read", description: "Consultar la clasificacion, el costo y la capitalizacion contable de activos" },
  { resource: "asset-accounting", action: "update", description: "Clasificar activos, registrar costos atribuibles y fijar parametros de depreciacion" },
  { resource: "asset-capitalization", action: "create", description: "Capitalizar activos fijos (escribe en el Kardex)" },
  { resource: "asset-depreciation", action: "read", description: "Consultar los cierres de depreciacion" },
  { resource: "asset-depreciation", action: "create", description: "Cerrar un mes de depreciacion (escribe en el Kardex)" },
  { resource: "asset-depreciation", action: "delete", description: "Anular el ultimo cierre de depreciacion (reversa en el Kardex)" },
  { resource: "asset-accounting-policy", action: "read", description: "Consultar la politica contable de activos (umbral y clases)" },
  { resource: "asset-accounting-policy", action: "update", description: "Definir la politica contable de activos (umbral y clases)" },
  // Baja contable (plan 008): confirmar es definitivo, por eso "approve" va aparte.
  { resource: "asset-write-offs", action: "read", description: "Consultar las bajas contables de activos" },
  { resource: "asset-write-offs", action: "create", description: "Preparar bajas contables (borrador, fotos y certificado notarial)" },
  { resource: "asset-write-offs", action: "approve", description: "Confirmar bajas contables de activos (definitivas)" },

  // Service Desk ITIL v4 (plan 009). Sin grantToUser a proposito: el admin
  // decide que roles abren tickets, cuales atienden y quienes aprueban.
  { resource: "service-tickets", action: "create", description: "Abrir tickets propios y seguirlos (portal Generar Ticket)" },
  { resource: "service-tickets", action: "read", description: "Ver la cola de tickets del Service Desk" },
  { resource: "service-tickets", action: "update", description: "Atender tickets: asignar, cambiar estado, comentar, activos" },
  { resource: "service-tickets", action: "approve", description: "Aprobar solicitudes de servicio (miembro del grupo aprobador)" },
  {
    resource: "service-tickets",
    action: "all_view",
    description: "Ver y trabajar los tickets de todos los grupos de soporte (Jefe de Soporte TI)",
  },
  { resource: "service-problems", action: "read", description: "Consultar problemas" },
  { resource: "service-problems", action: "create", description: "Registrar problemas" },
  { resource: "service-problems", action: "update", description: "Investigar y resolver problemas, errores conocidos" },
  { resource: "service-changes", action: "read", description: "Consultar cambios y su calendario" },
  { resource: "service-changes", action: "create", description: "Registrar solicitudes de cambio (RFC)" },
  { resource: "service-changes", action: "update", description: "Planificar, implementar y cerrar cambios" },
  { resource: "service-changes", action: "approve", description: "Aprobar cambios (miembro del CAB)" },
  { resource: "kb-articles", action: "read", description: "Consultar la base de conocimiento" },
  { resource: "kb-articles", action: "create", description: "Redactar articulos de conocimiento" },
  { resource: "kb-articles", action: "update", description: "Editar articulos y enviarlos a revision" },
  { resource: "kb-articles", action: "approve", description: "Publicar y retirar articulos de conocimiento" },
  { resource: "service-desk-settings", action: "read", description: "Ver la configuracion del Service Desk" },
  { resource: "service-desk-settings", action: "update", description: "Configurar grupos, catalogo, SLA y calendario del Service Desk" },
  { resource: "service-desk-reports", action: "read", description: "Ver indicadores del Service Desk" },

  // Acceso a salas de comunicaciones (plan 016): seguridad fisica, ninguno por defecto. El acceso se
  // pide y se aprueba por ticket (service-tickets:*), estos permisos administran y consultan.
  { resource: "comm-rooms", action: "read", description: "Consultar salas de comunicaciones" },
  { resource: "comm-rooms", action: "create", description: "Crear salas de comunicaciones" },
  { resource: "comm-rooms", action: "update", description: "Editar y desactivar salas de comunicaciones y su configuracion" },
  { resource: "comm-room-accesses", action: "read", description: "Consultar quien tiene acceso a las salas, quien lo autorizo y por que" },
  { resource: "comm-room-accesses", action: "delete", description: "Revocar accesos a salas de comunicaciones" },
  { resource: "comm-room-entries", action: "read", description: "Consultar los ingresos fisicos a las salas" },
  { resource: "comm-room-entries", action: "create", description: "Registrar ingresos y salidas de las salas" },
];

export interface ScreenAccessCatalogEntry {
  // Slug de la pantalla en ingles (glosario del proyecto). El permiso queda
  // como "<resource>:access" y es el permissionKey de su hoja en
  // menu-catalog.ts. No debe repetir un resource base (ej. "asset-kardex"),
  // por eso los sufijos -view/-management donde chocaban.
  resource: string;
  description: string;
  // Permisos base ("recurso:accion") que la pantalla necesita: transcripcion
  // del REQUIRED_PERMISSIONS de su vista en corporate-front (ver MODULE_PAGES
  // en routes/AppRoutes.tsx). Son el MINIMO de la pantalla: cada arranque
  // agrega los que falten (aditivo, sirve igual en un volumen limpio, en otro
  // host o en una base sembrada con una version anterior del catalogo) y la
  // API no deja quitarlos desde "Permisos de Pantalla". Lo que el admin
  // agregue por encima de este minimo se conserva y se puede quitar.
  includes: string[];
  // Permisos que la pantalla NO debe incluir: se quitan en cada arranque aunque una version anterior
  // del catalogo (o el admin) los haya agregado. Para corregir de seguridad un minimo ya sembrado.
  revokedIncludes?: string[];
}

// Permisos de pantalla (agrupadores, plan 006): al rol se le asigna uno por
// pantalla y hasPermission() lo expande a sus permisos base, sin tener que
// asignar cada uno. Los authorize() de la API y los REQUIRED_PERMISSIONS del
// front no cambian: se cumplen solos porque la expansion llega a /auth/me.
export const SCREEN_ACCESS_CATALOG: ScreenAccessCatalogEntry[] = [
  // Gerencia de Personas
  {
    resource: "employee-onboarding",
    description: "Pantalla: Nuevo Ingreso",
    includes: [
      "persons:create",
      "addresses:create",
      "employees:create",
      "employees:read",
      "employee-contracts:create",
      "previsional-institutions:read",
      "previsional-profiles:update",
      "users:create",
    ],
  },
  { resource: "position-creation", description: "Pantalla: Nuevo Cargo", includes: ["roles:read", "employees:create"] },
  {
    resource: "afp-assignment",
    description: "Pantalla: Asignar AFP",
    includes: ["employees:read", "previsional-institutions:read", "previsional-profiles:read", "previsional-profiles:update"],
  },
  {
    resource: "health-plan-assignment",
    description: "Pantalla: Asignar Salud",
    includes: ["employees:read", "previsional-institutions:read", "previsional-profiles:read", "previsional-profiles:update"],
  },
  {
    resource: "ccaf-mutual",
    description: "Pantalla: CCAF y Mutualidad",
    includes: ["previsional-institutions:read", "previred-settings:read", "previred-settings:update"],
  },
  {
    resource: "payroll-configuration",
    description: "Pantalla: Configuración de Remuneraciones",
    includes: ["payroll-settings:read", "payroll-settings:update", "payroll-parameters:read", "payroll-parameters:update"],
  },
  { resource: "role-creation", description: "Pantalla: Nuevo Rol", includes: ["roles:create", "permissions:read"] },
  { resource: "role-view", description: "Pantalla: Ver Rol", includes: ["roles:read"] },

  // Gerencia de TI > Permisos
  { resource: "permission-creation", description: "Pantalla: Nuevo Permiso", includes: ["permissions:create"] },
  { resource: "permission-view", description: "Pantalla: Ver Permisos", includes: ["permissions:read"] },
  {
    resource: "role-permission-assignment",
    description: "Pantalla: Modificar Permisos",
    includes: ["permissions:update", "roles:read"],
  },
  {
    resource: "access-permission-management",
    description: "Pantalla: Permisos de Pantalla",
    includes: ["permissions:update"],
  },
  { resource: "role-deactivation", description: "Pantalla: Deshabilitar Roles", includes: ["roles:read", "roles:delete"] },
  {
    resource: "role-activation",
    description: "Pantalla: Habilitar Roles",
    includes: ["roles:read", "roles:update", "roles:activate"],
  },

  // Gerencia de TI > Pantallas
  { resource: "screen-view", description: "Pantalla: Ver Pantallas", includes: ["menu-items:read"] },
  // permissions:create para crear el permiso de pantalla desde la misma vista
  // (sin el, la vista solo deja elegir uno existente). GET /menu-items acepta
  // create, no hace falta menu-items:read.
  {
    resource: "screen-creation",
    description: "Pantalla: Nueva Pantalla",
    includes: ["menu-items:create", "permissions:create"],
  },
  // menu-items:update ademas de lo que exige la vista hoy (create + roles:read,
  // vista todavia sin implementar): era el permiso de su item de menu y es su
  // proposito real.
  {
    resource: "screen-permission-assignment",
    description: "Pantalla: Asignar Permisos",
    includes: ["menu-items:create", "menu-items:update", "roles:read"],
  },

  // Adquisiciones
  {
    resource: "supplier-creation",
    description: "Pantalla: Crear Proveedor",
    includes: [
      "business-partners:create",
      "suppliers:create",
      "supplier-service-types:create",
      "supplier-delivery-terms:create",
      "addresses:create",
      "supplier-contacts:create",
    ],
  },
  { resource: "quote-request", description: "Pantalla: Solicitar Cotización", includes: ["purchase-requests:read", "quotes:create"] },
  {
    resource: "quote-upload",
    description: "Pantalla: Cargar Cotizaciones",
    includes: [
      "purchase-requests:read",
      "purchase-request-lines:read",
      "quotes:read",
      "quotes:create",
      "suppliers:read",
      "products:read",
      "supplier-products:read",
    ],
  },
  {
    resource: "purchase-order-sending",
    description: "Pantalla: Enviar Orden de Compra",
    includes: ["purchase-requests:read", "purchase-orders:read", "quotes:create", "suppliers:read", "supplier-contacts:read"],
  },
  // La imagen se sube con products:create (POST /products/:id/image acepta create o update).
  { resource: "product-creation", description: "Pantalla: Nuevo Producto", includes: ["products:create", "product-categories:read"] },
  { resource: "product-list", description: "Pantalla: Ver Productos", includes: ["products:read", "product-categories:read"] },
  {
    resource: "supplier-product-linking",
    description: "Pantalla: Vincular Productos a Proveedor",
    includes: ["suppliers:read", "products:read", "supplier-products:read", "supplier-products:create", "supplier-products:delete"],
  },
  { resource: "category-creation", description: "Pantalla: Nueva Categoria", includes: ["product-categories:create"] },
  { resource: "category-view", description: "Pantalla: Ver Categorias", includes: ["product-categories:read"] },
  {
    resource: "category-update",
    description: "Pantalla: Actualizar Categorias",
    includes: ["product-categories:read", "product-categories:update"],
  },

  // Solicitudes de compra
  // Retirada (plan 010): la solicitud se crea desde Generar Ticket. Se conserva
  // para no romper los roles que la tienen; la migracion les dio Generar Ticket.
  {
    resource: "purchase-request-creation",
    description: "Pantalla: Nueva Solicitud (retirada, usar Generar Ticket)",
    includes: ["purchase-requests:create", "purchase-request-lines:create"],
  },
  {
    resource: "request-approval",
    description: "Pantalla: Autorizar Solicitud",
    includes: ["purchase-requests:approve", "purchase-request-lines:read", "purchase-request-lines:update", "products:read"],
  },
  {
    resource: "quote-approval",
    description: "Pantalla: Aprobar Cotización",
    includes: [
      "purchase-requests:approve",
      "purchase-requests:read",
      "purchase-request-lines:read",
      "quotes:read",
      "authorizations:create",
      "suppliers:read",
      "products:read",
    ],
  },
  {
    resource: "purchase-order-attachment",
    description: "Pantalla: Adjuntar Orden de Compra",
    includes: [
      "purchase-requests:create",
      "purchase-requests:read",
      "quotes:read",
      "purchase-orders:read",
      "purchase-orders:create",
      "purchase-orders:update",
      "products:read",
      "suppliers:read",
    ],
  },
  {
    resource: "goods-receipt",
    description: "Pantalla: Recepcionar Mercadería",
    includes: [
      "purchase-requests:read",
      "purchase-orders:read",
      "goods-receipts:read",
      "goods-receipts:create",
      "authorizations:read",
      "authorizations:create",
      "suppliers:read",
    ],
  },
  {
    resource: "request-asset-status",
    description: "Pantalla: Estado de Activos por Solicitud",
    includes: ["purchase-requests:read", "assets:read"],
  },

  // Activos
  // asset-movements:read: al asignar se descarga el acta de entrega (GET /asset-movements/:id/handover.pdf).
  {
    resource: "asset-assignment",
    description: "Pantalla: Asignar Activos",
    includes: ["assets:read", "asset-movements:create", "asset-movements:read"],
  },
  // Movimiento Activos (plan 011). Reasignar es una pantalla de accion (como
  // Asignar); Visualizar y Formulario son de solo lectura.
  {
    resource: "asset-reassignment",
    description: "Pantalla: Reasignar Activos",
    includes: ["assets:read", "asset-movements:read", "asset-movements:create"],
  },
  {
    resource: "asset-assignment-list",
    description: "Pantalla: Visualizar Asignaciones",
    includes: ["assets:read", "asset-movements:read", "product-categories:read"],
  },
  {
    resource: "asset-decommission",
    description: "Pantalla: Dar de Baja Activos",
    includes: ["assets:read", "asset-decommissions:create"],
  },
  {
    resource: "asset-handover-form",
    description: "Pantalla: Formulario Asignación",
    includes: ["assets:read", "asset-movements:read"],
  },
  { resource: "asset-labels", description: "Pantalla: Etiquetas de Activos", includes: ["assets:read"] },
  {
    resource: "asset-kardex-view",
    description: "Pantalla: Kardex de Activos",
    includes: ["asset-kardex:read", "assets:read", "products:read"],
  },
  { resource: "inventory-taking", description: "Pantalla: Toma de Inventario", includes: ["inventory-counts:read"] },
  // Excepcion a la regla lectura/edicion, decidida por el usuario (2026-09-28): quien
  // tiene la pantalla de valorizacion tambien ingresa el valor.
  {
    resource: "asset-valuation-view",
    description: "Pantalla: Valorización de Activos",
    includes: ["asset-valuation:read", "asset-valuation:update"],
  },
  { resource: "asset-return-management", description: "Pantalla: Devoluciones de Activos", includes: ["asset-returns:read"] },
  { resource: "asset-bulk-import", description: "Pantalla: Carga Masiva de Activos", includes: ["asset-imports:read"] },

  // Agrupadores de edicion: la pantalla de arriba solo deja consultar (y es la
  // que abre la hoja del menu); estos habilitan sus acciones. Se otorgan aparte,
  // asi el admin separa quien mira de quien opera. No tienen hoja de menu propia:
  // el rol necesita los dos.
  {
    resource: "inventory-taking-edit",
    description: "Pantalla: Toma de Inventario (edición)",
    // Productos y categorias arman el alta de un equipo que no estaba registrado.
    includes: [
      "inventory-counts:read",
      "inventory-counts:create",
      "inventory-counts:update",
      "products:read",
      "product-categories:read",
    ],
  },
  {
    resource: "asset-valuation-edit",
    description: "Pantalla: Valorización de Activos (edición, incluida en la pantalla)",
    includes: ["asset-valuation:read", "asset-valuation:update"],
  },
  {
    resource: "asset-return-management-edit",
    description: "Pantalla: Devoluciones de Activos (edición)",
    includes: ["asset-returns:read", "asset-returns:create", "asset-returns:update"],
  },
  {
    resource: "asset-bulk-import-edit",
    description: "Pantalla: Carga Masiva de Activos (edición)",
    includes: ["asset-imports:read", "asset-imports:create"],
  },

  // Contabilidad > Gestion de Activos (plan 007)
  {
    resource: "accounting-classification",
    description: "Pantalla: Clasificación Contable",
    includes: ["asset-accounting:read", "asset-accounting:update", "asset-accounting-policy:read", "assets:read"],
  },
  {
    resource: "accounting-cost",
    description: "Pantalla: Determinar Costo",
    includes: ["asset-accounting:read", "asset-accounting:update", "assets:read"],
  },
  // Creado primero desde Nueva Pantalla en Development: la siembra le agrega
  // este minimo y conserva los includes que se le dieron desde la UI.
  {
    resource: "accounting-capitalization",
    description: "Pantalla: Capitalización",
    includes: ["asset-accounting:read", "asset-capitalization:create", "assets:read"],
  },
  {
    resource: "accounting-depreciation",
    description: "Pantalla: Depreciación",
    includes: ["asset-accounting:read", "asset-accounting:update", "asset-depreciation:read", "asset-depreciation:create"],
  },
  // Anular el ultimo cierre reversa el Kardex: se otorga aparte de cerrar el mes.
  {
    resource: "accounting-depreciation-void",
    description: "Pantalla: Depreciación (anular cierre)",
    includes: ["asset-depreciation:read", "asset-depreciation:delete"],
  },
  {
    resource: "accounting-policy",
    description: "Pantalla: Política Contable de Activos",
    includes: ["asset-accounting-policy:read", "asset-accounting-policy:update"],
  },
  {
    resource: "accounting-write-off",
    description: "Pantalla: Baja Contable",
    includes: ["asset-write-offs:read", "asset-write-offs:create", "asset-write-offs:approve", "asset-accounting:read"],
  },

  // Service Desk (plan 009). generate-ticket y support-services se crearon
  // primero desde Nueva Pantalla en Development: la siembra les agrega este
  // minimo y conserva lo que se les haya dado desde la UI. Las pestanas de
  // problemas, cambios, conocimiento e indicadores se ven segun sus propios
  // permisos, que el admin agrega al rol que corresponda.
  // La solicitud de equipo (plan 010) crea la solicitud de compra desde aqui:
  // cualquiera que use el portal puede pedir equipo (decision del usuario). Los
  // catalogos de producto y categoria arman el carrito; el beneficiario se
  // confirma con /service-portal/beneficiary, sin persons:read.
  {
    resource: "generate-ticket",
    description: "Pantalla: Generar Ticket",
    includes: [
      "service-tickets:create",
      "kb-articles:read",
      "purchase-requests:create",
      "purchase-request-lines:create",
      "products:read",
      "product-categories:read",
    ],
  },
  {
    resource: "support-services",
    description: "Pantalla: Gestión de Tickets",
    includes: ["service-tickets:read", "service-tickets:update", "kb-articles:read"],
  },
  {
    resource: "support-settings",
    description: "Pantalla: Configuración Service Desk",
    includes: ["service-desk-settings:read", "service-desk-settings:update"],
  },

  // Comunicaciones > Acceso Sala (plan 016).
  {
    resource: "comm-room-creation",
    description: "Pantalla: Crear Sala",
    includes: ["comm-rooms:create", "cost-centers:read"],
  },
  {
    resource: "comm-room-admin",
    description: "Pantalla: Administrar Salas",
    includes: ["comm-rooms:read", "comm-rooms:update", "comm-room-accesses:read", "comm-room-accesses:delete", "cost-centers:read"],
  },
  {
    resource: "comm-room-entry",
    description: "Pantalla: Registrar Ingreso",
    // Sin comm-rooms:read: lista las salas por /comm-room-entries/rooms, sin la direccion
    // (revision plan 016, L). La primera version lo incluia: se quita de las bases ya sembradas.
    includes: ["comm-room-entries:read", "comm-room-entries:create"],
    revokedIncludes: ["comm-rooms:read"],
  },
  {
    resource: "comm-room-access-report",
    description: "Pantalla: Consulta de Accesos",
    includes: ["comm-rooms:read", "comm-room-accesses:read", "comm-room-entries:read", "cost-centers:read"],
  },
];

// true si "<bundleResource>:access" exige "<includedKey>" como parte de su
// minimo del catalogo (ver ScreenAccessCatalogEntry.includes).
export function isCatalogScreenInclude(bundleResource: string, includedKey: string): boolean {
  return SCREEN_ACCESS_CATALOG.some((entry) => entry.resource === bundleResource && entry.includes.includes(includedKey));
}
