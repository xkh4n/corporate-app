import { RoleModel } from "../../models/postgres/role.model";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { RoleCreationAttributes, RoleUpdateAttributes } from "../../types/postgres/role.types";

export async function listRoles(): Promise<RoleModel[]> {
  return RoleModel.findAll({ order: [["id", "ASC"]] });
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
  if (data.name && data.name !== role.name) {
    const existing = await getRoleByName(data.name);
    if (existing) throw new ConflictError(`Ya existe el rol '${data.name}'`);
  }
  await role.update(data);
  return role;
}

export async function deactivateRole(id: number): Promise<void> {
  const role = await getRoleByIdOrThrow(id);
  await role.update({ isActive: false });
}
