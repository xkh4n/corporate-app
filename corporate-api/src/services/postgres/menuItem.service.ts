import { Op } from "sequelize";
import { MenuItemModel } from "../../models/postgres/menuItem.model";
import { PermissionModel } from "../../models/postgres/permission.model";
import { getEffectivePermissionsForRole } from "./permission.service";
import { BadRequestError, ConflictError, NotFoundError, isUniqueConstraintError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { MenuItemCreationAttributes, MenuItemUpdateAttributes, MenuNode } from "../../types/postgres/menuItem.types";

const SEARCH_FIELDS = ["label"];

export async function listMenuItems(
  params: PaginationParams,
): Promise<{ items: MenuItemModel[]; total: number }> {
  const { rows, count } = await MenuItemModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.iLike),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getMenuItemById(id: number): Promise<MenuItemModel | null> {
  return MenuItemModel.findByPk(id);
}

export async function getMenuItemByIdOrThrow(id: number): Promise<MenuItemModel> {
  const menuItem = await getMenuItemById(id);
  if (!menuItem) throw new NotFoundError(`El item de menu ${id} no existe`);
  return menuItem;
}

async function assertParentIsValid(parentId: number): Promise<void> {
  const parent = await MenuItemModel.findByPk(parentId);
  if (!parent || !parent.isActive) {
    throw new BadRequestError(`El item de menu padre ${parentId} no existe o esta inactivo`);
  }
}

// label es UNIQUE en la tabla (clave estable del seed, ver menu-catalog.ts)
// y link no lo es, pero dos items activos con el mismo link duplicarian la
// ruta en el front (AppRoutes arma una <Route> por link). Se chequean antes
// para responder 409 con un mensaje claro en vez del 500 de la UNIQUE.
async function assertLabelAndLinkAvailable(
  data: { label?: string; link?: string | null },
  excludeId?: number,
): Promise<void> {
  const notSelf = excludeId !== undefined ? { id: { [Op.ne]: excludeId } } : {};
  if (data.label) {
    const byLabel = await MenuItemModel.findOne({ where: { label: data.label, ...notSelf } });
    if (byLabel) throw new ConflictError(`Ya existe un item de menu llamado '${data.label}'`);
  }
  if (data.link) {
    const byLink = await MenuItemModel.findOne({ where: { link: data.link, isActive: true, ...notSelf } });
    if (byLink) throw new ConflictError(`La ruta '${data.link}' ya la usa el item de menu '${byLink.label}'`);
  }
}

// "recurso:accion" -> id real en permissions. El regex del controller
// (PERMISSION_KEY_REGEX) ya garantiza un solo ":", separar por split(":")
// es seguro incluso con resource/action que traen guiones propios
// (ej. "purchase-request-lines:update").
async function resolvePermissionId(permissionKey: string): Promise<number> {
  const [resource, action] = permissionKey.split(":");
  const permission = await PermissionModel.findOne({ where: { resource, action } });
  if (!permission) throw new BadRequestError(`El permiso '${permissionKey}' no existe en el catalogo`);
  return permission.id;
}

// Camina la cadena de padres de "candidateParentId" hacia la raiz: si en el
// camino aparece "nodeId", asignarlo como padre crearia un ciclo (el nodo
// terminaria siendo su propio ancestro). Sin esto, un arbol con un ciclo
// deja a getMenuTreeForRole en un loop infinito.
async function assertNoCycle(nodeId: number, candidateParentId: number): Promise<void> {
  let currentId: number | null = candidateParentId;
  while (currentId !== null) {
    if (currentId === nodeId) {
      throw new BadRequestError("El parentId elegido crearia un ciclo (el item terminaria siendo su propio ancestro)");
    }
    const current: MenuItemModel | null = await MenuItemModel.findByPk(currentId);
    currentId = current?.parentId ?? null;
  }
}

export async function createMenuItem(data: MenuItemCreationAttributes): Promise<MenuItemModel> {
  if (data.parentId !== undefined && data.parentId !== null) {
    await assertParentIsValid(data.parentId);
  }

  await assertLabelAndLinkAvailable(data);

  const { permissionKey, ...rest } = data;
  const permissionId = permissionKey ? await resolvePermissionId(permissionKey) : undefined;

  try {
    return await MenuItemModel.create({ ...rest, permissionId });
  } catch (err) {
    // Carrera entre dos altas con el mismo label: la UNIQUE es la que manda.
    if (isUniqueConstraintError(err)) throw new ConflictError(`Ya existe un item de menu llamado '${data.label}'`);
    throw err;
  }
}

export async function updateMenuItem(id: number, data: MenuItemUpdateAttributes): Promise<MenuItemModel> {
  const menuItem = await getMenuItemByIdOrThrow(id);

  if (data.parentId !== undefined && data.parentId !== null && data.parentId !== menuItem.parentId) {
    await assertParentIsValid(data.parentId);
    await assertNoCycle(id, data.parentId);
  }
  await assertLabelAndLinkAvailable(
    {
      label: data.label !== menuItem.label ? data.label : undefined,
      link: data.link !== menuItem.link ? data.link : undefined,
    },
    id,
  );

  const { permissionKey, ...rest } = data;
  const permissionId = permissionKey ? await resolvePermissionId(permissionKey) : undefined;

  await menuItem.update({ ...rest, ...(permissionId !== undefined ? { permissionId } : {}) });
  return menuItem;
}

// Soft-delete (mismo criterio que roles): rechaza si todavia tiene hijos
// activos, para no dejar un subarbol huerfano en silencio -hay que
// reparentar o desactivar los hijos primero, explicitamente.
export async function deactivateMenuItem(id: number): Promise<void> {
  const menuItem = await getMenuItemByIdOrThrow(id);
  const activeChildren = await MenuItemModel.count({ where: { parentId: id, isActive: true } });
  if (activeChildren > 0) {
    throw new ConflictError(`El item de menu ${id} tiene ${activeChildren} hijo(s) activo(s), reparentalos o desactivalos primero`);
  }
  await menuItem.update({ isActive: false });
}

// Arma el arbol de navegacion podado a lo que el rol puede ver. "admin"
// replica el bypass hardcodeado de authorize() (ver middlewares/authorize.ts)
// -ve el catalogo completo sin depender de que existan filas en
// role_permissions para su rol.
export async function getMenuTreeForRole(roleId: number, isAdmin: boolean): Promise<MenuNode[]> {
  const allItems = await MenuItemModel.findAll({
    where: { isActive: true },
    order: [["sortOrder", "ASC"], ["id", "ASC"]],
  });

  const childrenByParent = new Map<number | null, MenuItemModel[]>();
  for (const item of allItems) {
    const key = item.parentId;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(item);
  }

  let permissionIds: Set<number> | null = null;
  if (!isAdmin) {
    const permissions = await getEffectivePermissionsForRole(roleId);
    permissionIds = new Set(permissions.map((p) => p.id));
  }

  // Memoizado: cada nodo se evalua una sola vez aunque se lo consulte desde
  // buildTree y desde la recursion de otro hermano.
  const reachableMemo = new Map<number, boolean>();
  function isReachable(item: MenuItemModel): boolean {
    const memoized = reachableMemo.get(item.id);
    if (memoized !== undefined) return memoized;

    const direct = isAdmin || (item.permissionId !== null && permissionIds!.has(item.permissionId));
    const hasReachableChild = (childrenByParent.get(item.id) ?? []).some((child) => isReachable(child));
    const reachable = direct || hasReachableChild;

    reachableMemo.set(item.id, reachable);
    return reachable;
  }

  function buildTree(parentId: number | null): MenuNode[] {
    return (childrenByParent.get(parentId) ?? [])
      .filter((item) => isReachable(item))
      .map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        link: item.link,
        children: buildTree(item.id),
      }));
  }

  return buildTree(null);
}
