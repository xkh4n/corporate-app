import { Op } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { PermissionModel, type PermissionAction } from "../../models/postgres/permission.model";
import { RolePermissionModel } from "../../models/postgres/rolePermission.model";
import { getRoleByIdOrThrow } from "./role.service";
import { BadRequestError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";

const SEARCH_FIELDS = ["resource", "action", "description"];

// Catalogo fijo (databases/permission-catalog.ts): pocas decenas de filas,
// pero se pagina igual por consistencia con el resto de los listados.
export async function listPermissions(
  params: PaginationParams,
): Promise<{ items: PermissionModel[]; total: number }> {
  const { rows, count } = await PermissionModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.iLike),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getPermissionsForRole(roleId: number): Promise<PermissionModel[]> {
  await getRoleByIdOrThrow(roleId);
  return PermissionModel.findAll({
    include: [{ model: RolePermissionModel, as: "rolePermissions", where: { roleId }, attributes: [] }],
    order: [["resource", "ASC"], ["action", "ASC"]],
  });
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

  await postgres.transaction(async (transaction) => {
    await RolePermissionModel.destroy({ where: { roleId }, transaction });
    if (uniqueIds.length > 0) {
      await RolePermissionModel.bulkCreate(
        uniqueIds.map((permissionId) => ({ roleId, permissionId })),
        { transaction },
      );
    }
  });

  return getPermissionsForRole(roleId);
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
  return getPermissionsForRole(roleId);
}

// Quita un permiso puntual sin tocar los demas. Idempotente (DELETE sobre
// algo que ya no estaba asignado no es un error, mismo criterio REST que el
// resto de los "deactivate" de esta API).
export async function removeRolePermission(roleId: number, permissionId: number): Promise<void> {
  await getRoleByIdOrThrow(roleId);
  await RolePermissionModel.destroy({ where: { roleId, permissionId } });
}

// Usado por el middleware authorize() en cada request -"admin" tiene bypass
// hardcodeado antes de llegar aca (ver middlewares/authorize.ts), asi que
// esta consulta solo corre para roles no-admin.
export async function hasPermission(
  roleId: number,
  resource: string,
  action: PermissionAction,
): Promise<boolean> {
  const count = await RolePermissionModel.count({
    where: { roleId },
    include: [{ model: PermissionModel, as: "permission", where: { resource, action } }],
  });
  return count > 0;
}
