import { Op } from "sequelize";
import { RoleModel } from "../../models/postgres/role.model";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { RoleCreationAttributes, RoleUpdateAttributes } from "../../types/postgres/role.types";

const SEARCH_FIELDS = ["name", "description"];

// "admin" es el superusuario con bypass hardcodeado en authorize() por
// NOMBRE (ver middlewares/authorize.ts): desactivarlo o renombrarlo via API
// dejaria el sistema sin nadie capaz de administrar accesos. Decision del
// negocio (2026-09-23): solo se puede tocar con una query directa en el
// motor, nunca desde el front ni la API. 409 y no 403: el llamador SI tiene
// el permiso, lo que no se permite es esta operacion sobre este rol puntual
// (un 403 ademas manda al front a /403 en vez de mostrar el mensaje).
const PROTECTED_ROLE_NAME = "admin";

function assertNotProtectedRole(role: RoleModel, operation: string): void {
  if (role.name === PROTECTED_ROLE_NAME) {
    throw new ConflictError(`El rol '${PROTECTED_ROLE_NAME}' no se puede ${operation} desde la aplicacion`);
  }
}

export async function listRoles(params: PaginationParams): Promise<{ items: RoleModel[]; total: number }> {
  const { rows, count } = await RoleModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.iLike),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getRoleById(id: number): Promise<RoleModel | null> {
  return RoleModel.findByPk(id);
}

export async function getRoleByIdOrThrow(id: number): Promise<RoleModel> {
  const role = await getRoleById(id);
  if (!role) throw new NotFoundError(`El rol ${id} no existe`);
  return role;
}

export async function getRoleByName(name: string): Promise<RoleModel | null> {
  return RoleModel.findOne({ where: { name } });
}

export async function createRole(data: RoleCreationAttributes): Promise<RoleModel> {
  const existing = await getRoleByName(data.name);
  if (existing) throw new ConflictError(`Ya existe el rol '${data.name}'`);
  return RoleModel.create(data);
}

export async function updateRole(id: number, data: RoleUpdateAttributes): Promise<RoleModel> {
  const role = await getRoleByIdOrThrow(id);
  // Renombrarlo equivale a desactivarlo (el bypass de authorize() es por
  // nombre), asi que se bloquean ambos caminos por PUT /roles/:id.
  if (data.isActive === false) assertNotProtectedRole(role, "desactivar");
  if (data.name !== undefined && data.name !== role.name) assertNotProtectedRole(role, "renombrar");
  if (data.name && data.name !== role.name) {
    const existing = await getRoleByName(data.name);
    if (existing) throw new ConflictError(`Ya existe el rol '${data.name}'`);
  }
  await role.update(data);
  return role;
}

// Contraparte de deactivateRole. "admin" tampoco se toca por aca: su
// estado se administra solo por query directa en el motor. Idempotente: un
// rol ya activo se devuelve tal cual, sin error.
export async function activateRole(id: number): Promise<RoleModel> {
  const role = await getRoleByIdOrThrow(id);
  assertNotProtectedRole(role, "habilitar");
  if (!role.isActive) await role.update({ isActive: true });
  return role;
}

export async function deactivateRole(id: number): Promise<void> {
  const role = await getRoleByIdOrThrow(id);
  assertNotProtectedRole(role, "desactivar");
  await role.update({ isActive: false });
}
