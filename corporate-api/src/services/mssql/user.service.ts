import { Op } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { UserModel } from "../../models/mssql/user.model";
import { PersonModel } from "../../models/mssql/person.model";
import { PasswordHistoryModel } from "../../models/mssql/passwordHistory.model";
import { getPersonByIdOrThrow } from "./person.service";
import { getRoleByIdOrThrow } from "../postgres/role.service";
import { hashPassword, comparePassword, assertPasswordPolicy } from "../../library/password";
import { ConflictError, NotFoundError } from "../../library/errors";
import { env } from "../../library/env";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
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

const SEARCH_FIELDS = ["username"];

export async function listUsers(params: PaginationParams): Promise<{ items: SafeUser[]; total: number }> {
  const { rows, count } = await UserModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: [{ model: PersonModel, as: "person" }],
  });
  return { items: rows.map(toSafeUser), total: count };
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

// PASSWORD_HISTORY_LIMIT: no puede reutilizarse ninguna de las ultimas N
// contraseñas (incluyendo la ACTUAL, que todavia no esta en password_history
// -ese insert pasa recien despues de este check-). Transaccion: inserta el
// hash VIEJO en el historial, poda lo que sobre de las ultimas N, y recien
// ahi pisa users.password_hash -si algo falla a mitad de camino, no queda
// la contraseña cambiada con el historial a medio actualizar.
export async function changePassword(id: number, newPassword: string): Promise<void> {
  const user = await getUserByIdOrThrow(id);
  assertPasswordPolicy(newPassword);

  const historyLimit = env.password.historyLimit;
  if (historyLimit > 0) {
    if (await comparePassword(newPassword, user.passwordHash)) {
      throw new ConflictError("No puede reutilizar su contraseña actual", { field: "password" });
    }

    const recentHistory = await PasswordHistoryModel.findAll({
      where: { userId: id },
      order: [["createdAt", "DESC"]],
      limit: historyLimit - 1,
    });
    for (const entry of recentHistory) {
      if (await comparePassword(newPassword, entry.passwordHash)) {
        throw new ConflictError(
          `No puede reutilizar ninguna de sus ultimas ${historyLimit} contraseñas`,
          { field: "password" },
        );
      }
    }
  }

  const passwordHash = await hashPassword(newPassword);

  await mssql.transaction(async (transaction) => {
    await PasswordHistoryModel.create(
      { userId: id, passwordHash: user.passwordHash },
      { transaction },
    );

    if (historyLimit > 0) {
      const staleEntries = await PasswordHistoryModel.findAll({
        where: { userId: id },
        order: [["createdAt", "DESC"]],
        offset: historyLimit,
        transaction,
      });
      if (staleEntries.length > 0) {
        await PasswordHistoryModel.destroy({
          where: { id: staleEntries.map((entry) => entry.id) },
          transaction,
        });
      }
    }

    await user.update({ passwordHash }, { transaction });
  });
}

export async function deactivateUser(id: number): Promise<void> {
  const user = await getUserByIdOrThrow(id);
  await user.update({ isActive: false });
}

export async function touchLastLogin(id: number): Promise<void> {
  await UserModel.update({ lastLoginAt: new Date() }, { where: { id } });
}
