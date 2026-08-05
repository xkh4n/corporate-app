import { UserModel } from "../../models/mssql/user.model";
import { PersonModel } from "../../models/mssql/person.model";
import { getPersonByIdOrThrow } from "./person.service";
import { getRoleByIdOrThrow } from "../postgres/role.service";
import { hashPassword, assertPasswordPolicy } from "../../library/password";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { SafeUser, UserUpdateAttributes } from "../../types/mssql/user.types";

export interface CreateUserInput {
  personId: number;
  roleId: number;
  username: string;
  password: string;
}

function toSafeUser(user: UserModel): SafeUser {
  const { passwordHash, ...rest } = user.get({ plain: true });
  return rest;
}

export async function getUserByUsername(username: string): Promise<UserModel | null> {
  return UserModel.findOne({ where: { username }, include: [{ model: PersonModel, as: "person" }] });
}

export async function getUserById(id: number): Promise<UserModel | null> {
  return UserModel.findByPk(id, { include: [{ model: PersonModel, as: "person" }] });
}

export async function getUserByIdOrThrow(id: number): Promise<UserModel> {
  const user = await getUserById(id);
  if (!user) throw new NotFoundError(`El usuario ${id} no existe`);
  return user;
}

export async function listUsers(): Promise<SafeUser[]> {
  const users = await UserModel.findAll({
    include: [{ model: PersonModel, as: "person" }],
    order: [["id", "ASC"]],
  });
  return users.map(toSafeUser);
}

export async function createUser(input: CreateUserInput): Promise<SafeUser> {
  // Cross-DB: la persona vive en MSSQL, el rol en Postgres -sin FK real
  // posible entre motores, se valida a mano en la capa de servicio.
  await getPersonByIdOrThrow(input.personId);
  await getRoleByIdOrThrow(input.roleId);

  const existing = await UserModel.findOne({ where: { username: input.username } });
  if (existing) throw new ConflictError(`Ya existe el usuario '${input.username}'`);

  assertPasswordPolicy(input.password);
  const passwordHash = await hashPassword(input.password);

  const user = await UserModel.create({
    personId: input.personId,
    roleId: input.roleId,
    username: input.username,
    passwordHash,
  });

  return toSafeUser(await getUserByIdOrThrow(user.id));
}

export async function updateUser(id: number, data: UserUpdateAttributes): Promise<SafeUser> {
  const user = await getUserByIdOrThrow(id);

  if (data.roleId !== undefined) {
    await getRoleByIdOrThrow(data.roleId);
  }
  if (data.username && data.username !== user.username) {
    const existing = await UserModel.findOne({ where: { username: data.username } });
    if (existing) throw new ConflictError(`Ya existe el usuario '${data.username}'`);
  }

  await user.update(data);
  return toSafeUser(await getUserByIdOrThrow(id));
}

export async function changePassword(id: number, newPassword: string): Promise<void> {
  const user = await getUserByIdOrThrow(id);
  assertPasswordPolicy(newPassword);
  const passwordHash = await hashPassword(newPassword);
  await user.update({ passwordHash });
}

export async function deactivateUser(id: number): Promise<void> {
  const user = await getUserByIdOrThrow(id);
  await user.update({ isActive: false });
}

export async function touchLastLogin(id: number): Promise<void> {
  await UserModel.update({ lastLoginAt: new Date() }, { where: { id } });
}
