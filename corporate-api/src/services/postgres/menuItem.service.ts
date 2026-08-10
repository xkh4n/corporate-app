import { Op } from "sequelize";
import { MenuItemModel } from "../../models/postgres/menuItem.model";
import { PermissionModel } from "../../models/postgres/permission.model";
import { getPermissionsForRole } from "./permission.service";
import { BadRequestError, ConflictError, NotFoundError } from "../../library/errors";
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

async function assertPermissionExists(permissionId: number): Promise<void> {
  const permission = await PermissionModel.findByPk(permissionId);
  if (!permission) throw new BadRequestError(`El permiso ${permissionId} no existe en el catalogo`);
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
  if (data.permissionId !== undefined && data.permissionId !== null) {
    await assertPermissionExists(data.permissionId);
  }
  return MenuItemModel.create(data);
}

export async function updateMenuItem(id: number, data: MenuItemUpdateAttributes): Promise<MenuItemModel> {
  const menuItem = await getMenuItemByIdOrThrow(id);

  if (data.parentId !== undefined && data.parentId !== null && data.parentId !== menuItem.parentId) {
    await assertParentIsValid(data.parentId);
    await assertNoCycle(id, data.parentId);
  }
  if (data.permissionId !== undefined && data.permissionId !== null) {
    await assertPermissionExists(data.permissionId);
  }

  await menuItem.update(data);
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
    const permissions = await getPermissionsForRole(roleId);
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
