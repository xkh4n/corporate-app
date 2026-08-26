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

// Fuente unica de verdad del catalogo de permisos: sembrado en
// databases/seed.ts (seedPermissions) y consumido por authorize(resource,
// action) en cada *.routes.ts. Un resource nuevo se agrega aca + se gatea en
// su router; el catalogo es idempotente (insert con ignoreDuplicates), asi
// que agregar una fila nueva y redeployar alcanza, no hace falta migracion
// de datos manual.
export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  // Roles y permisos: gestion de acceso, admin-only por definicion.
  { resource: "roles", action: "read", description: "Consultar roles" },
  { resource: "roles", action: "create", description: "Crear roles" },
  { resource: "roles", action: "update", description: "Editar roles y sus permisos" },
  { resource: "roles", action: "delete", description: "Desactivar roles" },

  { resource: "permissions", action: "create", description: "Crear Permiso" },
  { resource: "permissions", action: "read", description: "Ver Permiso" },
  { resource: "permissions", action: "update", description: "Actualizar Permiso" },
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
  { resource: "products", action: "read", description: "Listar productos" },
  { resource: "products", action: "update", description: "Editar productos" },
  { resource: "products", action: "delete", description: "Desactivar productos" },
  
  { resource: "product-categories", action: "create", description: "Crear categorias de producto" },
  { resource: "product-categories", action: "update", description: "Editar categorias de producto" },
  { resource: "product-categories", action: "read", description: "Listar categorias de producto" },
  
  { resource: "asset-statuses", action: "create", description: "Crear estados de activo" },
  { resource: "asset-statuses", action: "update", description: "Editar estados de activo" },
  { resource: "asset-statuses", action: "read", description: "Listar estados de activo" },

  // Flujo operativo de compras/activos: hoy abierto a cualquier autenticado
  // -se preserva para "user", pero ahora se puede restringir por rol nuevo.
  { resource: "addresses", action: "read", description: "Consultar direcciones", grantToUser: true },
  { resource: "addresses", action: "create", description: "Crear direcciones", grantToUser: true },
  { resource: "addresses", action: "update", description: "Editar direcciones", grantToUser: true },

  { resource: "purchase-requests",action: "create",description: "Crear solicitudes de compra",grantToUser: true,},
  { resource: "purchase-requests",action: "read",description: "Consultar solicitudes de compra",grantToUser: true,},
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

  // Kardex de valorizacion contable: admin-only por defecto (sin
  // grantToUser), encaja con el caso de uso de rol "contabilidad" separado
  // de "adquisiciones" que ya se planteo para el RBAC granular.
  { resource: "asset-kardex", action: "read", description: "Consultar el kardex de valorizacion de activos" },
  { resource: "asset-kardex", action: "create", description: "Registrar asientos manuales de kardex (ajuste/baja)" },
];
