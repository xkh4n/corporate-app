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
  { resource: "roles", action: "create", description: "Crear roles" },
  { resource: "roles", action: "update", description: "Editar roles y sus permisos" },
  { resource: "roles", action: "delete", description: "Desactivar roles" },

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
  { resource: "business-partners", action: "create", description: "Crear terceros" },
  { resource: "business-partners", action: "update", description: "Editar terceros" },
  { resource: "cost-centers", action: "create", description: "Crear centros de costo" },
  { resource: "cost-centers", action: "update", description: "Editar centros de costo" },
  { resource: "suppliers", action: "create", description: "Crear proveedores" },
  { resource: "suppliers", action: "update", description: "Editar proveedores" },
  { resource: "customers", action: "create", description: "Crear clientes" },
  { resource: "employees", action: "create", description: "Crear colaboradores" },
  { resource: "employees", action: "update", description: "Editar colaboradores" },
  { resource: "products", action: "create", description: "Crear productos" },
  { resource: "products", action: "update", description: "Editar productos" },
  { resource: "products", action: "delete", description: "Desactivar productos" },
  { resource: "asset-statuses", action: "create", description: "Crear estados de activo" },
  { resource: "asset-statuses", action: "update", description: "Editar estados de activo" },

  // Flujo operativo de compras/activos: hoy abierto a cualquier autenticado
  // -se preserva para "user", pero ahora se puede restringir por rol nuevo.
  { resource: "addresses", action: "create", description: "Crear direcciones", grantToUser: true },
  { resource: "addresses", action: "update", description: "Editar direcciones", grantToUser: true },
  {
    resource: "purchase-requests",
    action: "create",
    description: "Crear solicitudes de compra",
    grantToUser: true,
  },
  {
    resource: "purchase-requests",
    action: "read",
    description: "Consultar solicitudes de compra",
    grantToUser: true,
  },
  {
    resource: "purchase-requests",
    action: "update",
    description: "Editar solicitudes de compra (datos, no el estado)",
    grantToUser: true,
  },
  // Separado de "update" a proposito: aprobar/rechazar el estado de una
  // solicitud es una accion mas sensible que editar sus datos -mismo
  // criterio de segregacion de funciones que la regla de negocio en
  // authorization.service.ts (el solicitante no puede autorizar su propia
  // compra). No se otorga a "user" por defecto: solo admin, hasta que se
  // asigne explicitamente a un rol "aprobador".
  {
    resource: "purchase-requests",
    action: "approve",
    description: "Aprobar o rechazar el estado de una solicitud de compra",
  },
  // Sin endpoint todavia (no existe DELETE /purchase-requests) -reservado
  // para cuando se agregue cancelar/eliminar una solicitud.
  {
    resource: "purchase-requests",
    action: "delete",
    description: "Eliminar solicitudes de compra",
  },
  {
    resource: "purchase-request-lines",
    action: "create",
    description: "Crear lineas de solicitud",
    grantToUser: true,
  },
  {
    resource: "purchase-request-lines",
    action: "update",
    description: "Editar lineas de solicitud",
    grantToUser: true,
  },
  { resource: "quotes", action: "create", description: "Crear cotizaciones", grantToUser: true },
  { resource: "authorizations", action: "create", description: "Autorizar compras", grantToUser: true },
  {
    resource: "purchase-orders",
    action: "create",
    description: "Crear ordenes de compra",
    grantToUser: true,
  },
  {
    resource: "goods-receipts",
    action: "create",
    description: "Registrar recepciones de mercaderia",
    grantToUser: true,
  },
  { resource: "assets", action: "update", description: "Editar activos", grantToUser: true },
  {
    resource: "asset-movements",
    action: "create",
    description: "Registrar movimientos de activos (asignar/mover)",
    grantToUser: true,
  },
];
