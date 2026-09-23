import { Op, QueryTypes, type InferAttributes } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { PermissionModel, type PermissionAction } from "../../models/postgres/permission.model";
import { RolePermissionModel } from "../../models/postgres/rolePermission.model";
import { PermissionIncludeModel } from "../../models/postgres/permissionInclude.model";
import { RoleModel } from "../../models/postgres/role.model";
import { getRoleByIdOrThrow } from "./role.service";
import { BadRequestError, ConflictError, NotFoundError, isUniqueConstraintError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";

const SEARCH_FIELDS = ["resource", "action", "description"];

// Accion de los permisos de pantalla (agrupadores, plan 006): incluyen los
// permisos base que su vista necesita (tabla permission_includes).
export const ACCESS_ACTION: PermissionAction = "access";

type IncludedPermission = Pick<PermissionModel, "id" | "resource" | "action" | "description">;
export type PermissionWithIncludes = InferAttributes<PermissionModel> & { includedPermissions: IncludedPermission[] };

// Mapa agrupador -> permisos que incluye, para un set de ids de agrupadores.
async function getIncludesByPermissionId(accessIds: number[]): Promise<Map<number, IncludedPermission[]>> {
  const byParent = new Map<number, IncludedPermission[]>();
  if (accessIds.length === 0) return byParent;

  const links = await PermissionIncludeModel.findAll({ where: { permissionId: accessIds } });
  if (links.length === 0) return byParent;

  const included = await PermissionModel.findAll({
    where: { id: [...new Set(links.map((link) => link.includedPermissionId))] },
    attributes: ["id", "resource", "action", "description"],
    order: [["resource", "ASC"], ["action", "ASC"]],
  });
  const includedById = new Map(included.map((permission) => [permission.id, permission]));

  for (const link of links) {
    const permission = includedById.get(link.includedPermissionId);
    if (!permission) continue;
    const list = byParent.get(link.permissionId) ?? [];
    list.push(permission);
    byParent.set(link.permissionId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.resource.localeCompare(b.resource) || a.action.localeCompare(b.action));
  }
  return byParent;
}

// Pocas decenas de filas (catalogo base de databases/permission-catalog.ts +
// los creados en caliente via POST /permissions), pero se pagina igual por
// consistencia con el resto de los listados. Cada fila trae
// includedPermissions (vacio salvo en los agrupadores "access"), resuelto en
// una segunda consulta en vez de un include M:N para no complicar el conteo
// y el orden de findAndCountAll.
export async function listPermissions(
  params: PaginationParams,
): Promise<{ items: PermissionWithIncludes[]; total: number }> {
  const { rows, count } = await PermissionModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.iLike),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  const includes = await getIncludesByPermissionId(
    rows.filter((permission) => permission.action === ACCESS_ACTION).map((permission) => permission.id),
  );
  const items = rows.map((permission) => ({
    ...permission.get({ plain: true }),
    includedPermissions: includes.get(permission.id) ?? [],
  }));
  return { items, total: count };
}

// Valida que cada id exista y NO sea un agrupador: un solo nivel de
// inclusion (sin anidar), asi no hay ciclos posibles ni expansiones
// recursivas en hasPermission().
async function assertIncludableIds(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await PermissionModel.findAll({ where: { id: ids }, attributes: ["id", "action"] });
  if (found.length !== ids.length) {
    throw new BadRequestError("Uno o mas permisos a incluir no existen en el catalogo");
  }
  if (found.some((permission) => permission.action === ACCESS_ACTION)) {
    throw new BadRequestError("Un permiso de pantalla (access) no puede incluir a otro permiso de pantalla");
  }
}

// Alta en caliente de un permiso (POST /permissions): antes la unica forma
// de sumar uno era editar permission-catalog.ts y recrear los contenedores
// para que seedPermissions lo insertara. Sirve para gatear pantallas nuevas
// creadas desde "Nueva Pantalla" (menu_items.permission_id) sin redeploy
// -authorize(), /auth/me y /auth/menu ya leen todo desde la tabla. El seed
// no pisa estas filas: solo inserta las del catalogo y sincroniza su
// description (ON CONFLICT (resource,action)), nunca borra.
// Se le asigna de una a "admin" -mismo criterio que seedPermissions: admin
// ya tiene bypass en authorize(), pero sin la fila el front (can(), que
// arma su lista desde role_permissions via /auth/me) no le mostraria las
// pantallas gateadas por este permiso hasta el proximo reinicio.
// includedPermissionIds solo aplica a los agrupadores (action "access").
export async function createPermission(data: {
  resource: string;
  action: PermissionAction;
  description: string;
  includedPermissionIds?: number[];
}): Promise<PermissionWithIncludes> {
  const { includedPermissionIds, ...attributes } = data;
  const includedIds = [...new Set(includedPermissionIds ?? [])];
  if (includedIds.length > 0 && attributes.action !== ACCESS_ACTION) {
    throw new BadRequestError("Solo un permiso de pantalla (access) puede incluir otros permisos");
  }
  await assertIncludableIds(includedIds);

  const existing = await PermissionModel.findOne({
    where: { resource: attributes.resource, action: attributes.action },
  });
  if (existing) throw new ConflictError(`Ya existe el permiso '${attributes.resource}:${attributes.action}'`);

  const adminRole = await RoleModel.findOne({ where: { name: "admin" }, attributes: ["id"] });
  try {
    const permission = await postgres.transaction(async (transaction) => {
      const created = await PermissionModel.create(attributes, { transaction });
      if (adminRole) {
        await RolePermissionModel.create({ roleId: adminRole.id, permissionId: created.id }, { transaction });
      }
      if (includedIds.length > 0) {
        await PermissionIncludeModel.bulkCreate(
          includedIds.map((includedPermissionId) => ({ permissionId: created.id, includedPermissionId })),
          { transaction },
        );
      }
      return created;
    });
    const includes = await getIncludesByPermissionId([permission.id]);
    return { ...permission.get({ plain: true }), includedPermissions: includes.get(permission.id) ?? [] };
  } catch (err) {
    // Carrera entre dos altas simultaneas del mismo resource+action: el
    // findOne de arriba no alcanza, la UNIQUE (resource, action) es la que
    // manda.
    if (isUniqueConstraintError(err)) {
      throw new ConflictError(`Ya existe el permiso '${attributes.resource}:${attributes.action}'`);
    }
    throw err;
  }
}

async function getAccessPermissionOrThrow(id: number): Promise<PermissionModel> {
  const permission = await PermissionModel.findByPk(id);
  if (!permission) throw new NotFoundError(`El permiso ${id} no existe`);
  if (permission.action !== ACCESS_ACTION) {
    throw new BadRequestError("Solo un permiso de pantalla (access) puede incluir otros permisos");
  }
  return permission;
}

export async function getPermissionIncludes(id: number): Promise<IncludedPermission[]> {
  const includes = await getIncludesByPermissionId([id]);
  return includes.get(id) ?? [];
}

// Agrega un permiso base a un agrupador. Cambia al instante el acceso
// efectivo de TODOS los roles que tienen el agrupador -por eso la ruta exige
// "permissions:update", lo mismo que asignar permisos a un rol. Idempotente.
export async function addPermissionInclude(id: number, includedPermissionId: number): Promise<IncludedPermission[]> {
  await getAccessPermissionOrThrow(id);
  await assertIncludableIds([includedPermissionId]);
  await PermissionIncludeModel.findOrCreate({ where: { permissionId: id, includedPermissionId } });
  return getPermissionIncludes(id);
}

// Quita un permiso base de un agrupador. Idempotente.
export async function removePermissionInclude(id: number, includedPermissionId: number): Promise<void> {
  await getAccessPermissionOrThrow(id);
  await PermissionIncludeModel.destroy({ where: { permissionId: id, includedPermissionId } });
}

// Solo lo asignado DIRECTAMENTE al rol (role_permissions), sin expandir
// agrupadores. Es lo que muestra y edita "Modificar Permisos"
// (GET/PUT/POST/DELETE /roles/:id/permissions): quitar un permiso base que el
// rol solo tiene via agrupador no tendria efecto, asi que no se lista.
export async function getAssignedPermissionsForRole(roleId: number): Promise<PermissionModel[]> {
  await getRoleByIdOrThrow(roleId);
  return PermissionModel.findAll({
    include: [{ model: RolePermissionModel, as: "rolePermissions", where: { roleId }, attributes: [] }],
    order: [["resource", "ASC"], ["action", "ASC"]],
  });
}

// Lo que el rol puede hacer de verdad: lo asignado + lo que incluye cada
// agrupador "access" asignado, sin duplicados. Lo usan /auth/me (can() en el
// front), el arbol del menu y GET /users/:id/access. Mismo criterio que
// hasPermission(), que es el que aplica authorize() en cada request.
export async function getEffectivePermissionsForRole(roleId: number): Promise<PermissionModel[]> {
  const assigned = await getAssignedPermissionsForRole(roleId);
  const accessIds = assigned.filter((permission) => permission.action === ACCESS_ACTION).map((p) => p.id);
  if (accessIds.length === 0) return assigned;

  const links = await PermissionIncludeModel.findAll({ where: { permissionId: accessIds } });
  const assignedIds = new Set(assigned.map((permission) => permission.id));
  const extraIds = [...new Set(links.map((link) => link.includedPermissionId))].filter((id) => !assignedIds.has(id));
  if (extraIds.length === 0) return assigned;

  const extra = await PermissionModel.findAll({ where: { id: extraIds } });
  return [...assigned, ...extra].sort(
    (a, b) => a.resource.localeCompare(b.resource) || a.action.localeCompare(b.action),
  );
}

// Para cada permiso de targetIds, los agrupadores "access" de assignedIds
// que lo incluyen.
async function findBundlesGranting(
  assignedIds: number[],
  targetIds: number[],
): Promise<Map<number, PermissionModel[]>> {
  const byTarget = new Map<number, PermissionModel[]>();
  if (assignedIds.length === 0 || targetIds.length === 0) return byTarget;

  const bundles = await PermissionModel.findAll({ where: { id: assignedIds, action: ACCESS_ACTION } });
  if (bundles.length === 0) return byTarget;
  const bundleById = new Map(bundles.map((bundle) => [bundle.id, bundle]));

  const links = await PermissionIncludeModel.findAll({
    where: { permissionId: [...bundleById.keys()], includedPermissionId: targetIds },
  });
  for (const link of links) {
    const list = byTarget.get(link.includedPermissionId) ?? [];
    list.push(bundleById.get(link.permissionId)!);
    byTarget.set(link.includedPermissionId, list);
  }
  return byTarget;
}

// Ids de los permisos base que un rol ya obtiene via sus agrupadores
// asignados. Lo usa el seed para no volver a asignar directo lo que ya
// cubre un agrupador (ver seedPermissions).
export async function getPermissionIdsCoveredByBundles(roleId: number): Promise<Set<number>> {
  const assigned = await RolePermissionModel.findAll({ where: { roleId }, attributes: ["permissionId"] });
  const bundles = await PermissionModel.findAll({
    where: { id: assigned.map((row) => row.permissionId), action: ACCESS_ACTION },
    attributes: ["id"],
  });
  if (bundles.length === 0) return new Set();
  const links = await PermissionIncludeModel.findAll({
    where: { permissionId: bundles.map((bundle) => bundle.id) },
    attributes: ["includedPermissionId"],
  });
  return new Set(links.map((link) => link.includedPermissionId));
}

// Revocacion efectiva (hallazgo de la revision de seguridad 2026-09-23):
// quitar la asignacion directa de un permiso que el rol SIGUE teniendo via
// un agrupador "access" asignado no le quita el acceso -hasPermission() lo
// concede por el include-, pero la respuesta y la UI daban a entender que
// si. Se rechaza con 409 nombrando las pantallas que lo otorgan, sin borrar
// nada: hay que quitar primero esa pantalla del rol o editarla en "Permisos
// de Pantalla".
async function assertRevocationIsEffective(removedIds: number[], remainingAssignedIds: number[]): Promise<void> {
  const grantedBy = await findBundlesGranting(remainingAssignedIds, removedIds);
  if (grantedBy.size === 0) return;

  const removed = await PermissionModel.findAll({ where: { id: [...grantedBy.keys()] } });
  const details = removed.map((permission) => ({
    permission: `${permission.resource}:${permission.action}`,
    grantedBy: (grantedBy.get(permission.id) ?? []).map((bundle) => `${bundle.resource}:${bundle.action}`),
  }));
  const first = removed[0];
  if (!first) return;
  const firstBundles = (grantedBy.get(first.id) ?? []).map((bundle) => `"${bundle.description ?? bundle.resource}"`);
  throw new ConflictError(
    `No se puede quitar "${first.description ?? `${first.resource}:${first.action}`}": el rol lo sigue teniendo ` +
      `por ${firstBundles.join(", ")}. Quite primero esa pantalla del rol o editela en Permisos de Pantalla.`,
    { stillGranted: details },
  );
}

// Reemplaza el set completo de permisos de un rol (no incremental): mas
// simple y predecible para un formulario "estos son los permisos del rol"
// que aceptar altas/bajas una por una.
export async function setRolePermissions(
  roleId: number,
  permissionIds: number[],
): Promise<PermissionModel[]> {
  await getRoleByIdOrThrow(roleId);

  const uniqueIds = [...new Set(permissionIds)];
  if (uniqueIds.length > 0) {
    const found = await PermissionModel.findAll({ where: { id: uniqueIds } });
    if (found.length !== uniqueIds.length) {
      throw new BadRequestError("Uno o mas permissionIds no existen en el catalogo");
    }
  }

  const current = await RolePermissionModel.findAll({ where: { roleId }, attributes: ["permissionId"] });
  const keep = new Set(uniqueIds);
  const removedIds = current.map((row) => row.permissionId).filter((id) => !keep.has(id));
  await assertRevocationIsEffective(removedIds, uniqueIds);

  await postgres.transaction(async (transaction) => {
    await RolePermissionModel.destroy({ where: { roleId }, transaction });
    if (uniqueIds.length > 0) {
      await RolePermissionModel.bulkCreate(
        uniqueIds.map((permissionId) => ({ roleId, permissionId })),
        { transaction },
      );
    }
  });

  return getAssignedPermissionsForRole(roleId);
}

// Agrega un permiso puntual sin tocar los demas que ya tenia el rol -a
// diferencia de setRolePermissions (reemplazo completo), pensado para un
// boton "agregar permiso" en el frontend. findOrCreate lo hace idempotente:
// si el rol ya tenia ese permiso, no pasa nada (no es un error).
export async function addRolePermission(
  roleId: number,
  permissionId: number,
): Promise<PermissionModel[]> {
  await getRoleByIdOrThrow(roleId);
  const permission = await PermissionModel.findByPk(permissionId);
  if (!permission) throw new BadRequestError(`El permiso ${permissionId} no existe en el catalogo`);

  await RolePermissionModel.findOrCreate({ where: { roleId, permissionId } });
  return getAssignedPermissionsForRole(roleId);
}

// Quita un permiso puntual sin tocar los demas. Idempotente (DELETE sobre
// algo que ya no estaba asignado no es un error, mismo criterio REST que el
// resto de los "deactivate" de esta API), salvo que el rol lo siga teniendo
// via un agrupador: ahi responde 409 (ver assertRevocationIsEffective).
export async function removeRolePermission(roleId: number, permissionId: number): Promise<void> {
  await getRoleByIdOrThrow(roleId);
  const assigned = await RolePermissionModel.findAll({ where: { roleId }, attributes: ["permissionId"] });
  await assertRevocationIsEffective(
    [permissionId],
    assigned.map((row) => row.permissionId).filter((id) => id !== permissionId),
  );
  await RolePermissionModel.destroy({ where: { roleId, permissionId } });
}

// Condicion "la fila p de role_permissions otorga :resource/:action": el
// permiso directo, o un agrupador "access" que lo incluye (un solo nivel,
// ver assertIncludableIds). Compartida por hasPermission y
// getRoleIdsWithPermission para que ambos expandan exactamente igual.
const GRANTS_PERMISSION_SQL = `
  (p.resource = :resource AND p.action = :action)
  OR (p.action = 'access' AND EXISTS (
    SELECT 1
      FROM permission_includes pi
      JOIN permissions ip ON ip.id = pi.included_permission_id
     WHERE pi.permission_id = p.id
       AND ip.resource = :resource
       AND ip.action = :action
  ))
`;

// Usado por el middleware authorize() en cada request -"admin" tiene bypass
// hardcodeado antes de llegar aca (ver middlewares/authorize.ts), asi que
// esta consulta solo corre para roles no-admin. Exige roles.is_active=true
// -antes esta funcion ignoraba por completo el estado del rol: "desactivar"
// un rol (DELETE /roles/:id) no le quitaba ningun acceso real a nadie que ya
// lo tuviera asignado, quedaba como un flag sin efecto (hallazgo de
// auditoria de seguridad 2026-08-07). Desde el plan 006 tambien concede el
// permiso si el rol tiene un agrupador "access" que lo incluye -una sola
// consulta, porque corre en cada request.
export async function hasPermission(
  roleId: number,
  resource: string,
  action: PermissionAction,
): Promise<boolean> {
  const rows = await postgres.query(
    `SELECT 1
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id AND r.is_active = true
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = :roleId
        AND (${GRANTS_PERMISSION_SQL})
      LIMIT 1`,
    { replacements: { roleId, resource, action }, type: QueryTypes.SELECT },
  );
  return rows.length > 0;
}

// A diferencia de hasPermission (usada por el middleware authorize() para
// roles NO-admin), esta variante replica tambien el bypass de "admin"
// (hardcodeado en authorize.ts, no depende de filas en role_permissions).
// Para casos donde el codigo de servicio -no un middleware con req.user ya
// resuelto- necesita responder "¿este rol puede hacer X?" de forma completa
// (ej. validar que el aprobador elegido en una solicitud realmente pueda
// aprobar, ver purchaseRequest.service.ts).
export async function roleGrantsPermission(
  roleId: number,
  resource: string,
  action: PermissionAction,
): Promise<boolean> {
  const role = await getRoleByIdOrThrow(roleId);
  if (!role.isActive) return false;
  if (role.name === "admin") return true;
  return hasPermission(roleId, resource, action);
}

// Todos los roleId (activos) que otorgan un permiso dado -directo o via un
// agrupador "access" que lo incluye, e incluyendo "admin" aunque no tenga
// filas propias en role_permissions (mismo bypass que
// roleGrantsPermission/authorize()). Usado para armar listas de "personas
// elegibles para X" (ej. aprobadores de solicitudes de compra, ver
// purchaseRequest.service.ts listApprovers) sin tener que iterar rol por rol.
export async function getRoleIdsWithPermission(resource: string, action: PermissionAction): Promise<number[]> {
  const rows = await postgres.query<{ role_id: number }>(
    `SELECT DISTINCT rp.role_id
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id AND r.is_active = true
       JOIN permissions p ON p.id = rp.permission_id
      WHERE ${GRANTS_PERMISSION_SQL}`,
    { replacements: { resource, action }, type: QueryTypes.SELECT },
  );
  const roleIds = new Set(rows.map((row) => Number(row.role_id)));

  const adminRole = await RoleModel.findOne({ where: { name: "admin", isActive: true }, attributes: ["id"] });
  if (adminRole) roleIds.add(adminRole.id);

  return [...roleIds];
}
