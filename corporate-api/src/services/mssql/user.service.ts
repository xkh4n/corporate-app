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
import { readSecretFromEnv } from "../../library/secrets";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { SafeUser, UserUpdateAttributes } from "../../types/mssql/user.types";

export interface CreateUserInput {
  personId: number;
  roleId: number;
  username: string;
  // Opcional: si quien crea el User no manda password (caso tipico, alta de
  // colaborador desde el front), se aplica el valor fijo de
  // env.users.defaultPasswordFileVar -nunca viaja por la red, se lee server-side.
  password?: string;
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

// Resuelve el User (si existe) dueño de una Person -usado para notificar al
// solicitante cuando su solicitud pasa a QUOTE_APPROVED (ver
// authorization.service.ts): requesterId es un personId, no todo Person
// tiene necesariamente una cuenta. null es un resultado valido, no un error
// -el caller decide que hacer (hoy: solo loguear y seguir).
export async function getUserByPersonId(personId: number): Promise<UserModel | null> {
  return UserModel.findOne({ where: { personId }, include: [{ model: PersonModel, as: "person" }] });
}

export interface UserDirectoryEntry {
  userId: number;
  fullName: string;
  email: string | null;
  isActive: boolean;
}

// Nombre y correo de varios usuarios de una vez (Service Desk, plan 009):
// las pantallas muestran nombres y los avisos van por correo. Solo lo
// necesario para eso, sin el resto de los datos personales.
export async function getUserDirectory(userIds: number[]): Promise<Map<number, UserDirectoryEntry>> {
  const unique = [...new Set(userIds.filter((id) => Number.isInteger(id)))];
  const result = new Map<number, UserDirectoryEntry>();
  if (unique.length === 0) return result;
  const users = await UserModel.findAll({
    where: { id: { [Op.in]: unique } },
    include: [{ model: PersonModel, as: "person" }],
  });
  for (const user of users) {
    result.set(user.id, {
      userId: user.id,
      fullName: user.person ? `${user.person.firstName} ${user.person.lastName}`.trim() : user.username,
      email: user.person?.email ?? null,
      isActive: user.isActive,
    });
  }
  return result;
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

// Usado al desactivar un rol (ver role.controller.ts) para invalidar de
// inmediato la sesion/access-token de cada usuario que lo tenia asignado
// -sin esto, "desactivar" un rol no cortaba ningun acceso ya emitido
// (hallazgo de auditoria de seguridad 2026-08-07).
export async function listUserIdsByRoleId(roleId: number): Promise<number[]> {
  const users = await UserModel.findAll({ where: { roleId }, attributes: ["id"] });
  return users.map((user) => user.id);
}

// Usado para armar listas de "usuarios elegibles para X" a partir de un set
// de roleId ya resuelto en Postgres (ver permission.service.ts
// getRoleIdsWithPermission) -cross-DB, por eso recibe los roleId ya
// calculados en vez de resolver el permiso aca mismo.
export async function listUsersByRoleIds(roleIds: number[]): Promise<SafeUser[]> {
  if (roleIds.length === 0) return [];
  const users = await UserModel.findAll({
    where: { roleId: { [Op.in]: roleIds }, isActive: true },
    include: [{ model: PersonModel, as: "person" }],
    order: [["username", "ASC"]],
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

  // Sin password explicita: se usa el valor fijo del secret (ver env.ts,
  // users.defaultPasswordFileVar) -nunca pasa por el body/red, se lee y
  // hashea directo aca.
  const password = input.password ?? readSecretFromEnv(env.users.defaultPasswordFileVar);
  assertPasswordPolicy(password);
  const passwordHash = await hashPassword(password);

  const user = await UserModel.create({
    personId: input.personId,
    roleId: input.roleId,
    username: input.username,
    passwordHash,
    // Toda cuenta nueva arranca con una password que el usuario no eligio
    // (la mando quien lo creo, o es el valor por defecto): se fuerza el
    // cambio en el primer login (ver /auth/me y PATCH /auth/change-password).
    mustChangePassword: true,
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
// mustChangePassword es obligatorio (sin default) para que cada caller sea
// explicito sobre su intencion, en vez de heredar un default que le queda
// mal a la mitad de los casos: true para el reset administrativo (PATCH
// /users/:id/password, ver user.controller.ts -alguien mas eligio la
// password nueva), false para el auto-servicio (PATCH /auth/change-password,
// ver auth.controller.ts -el propio dueño de la cuenta la eligio).
export async function changePassword(
  id: number,
  newPassword: string,
  options: { mustChangePassword: boolean },
): Promise<void> {
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

    await user.update({ passwordHash, mustChangePassword: options.mustChangePassword }, { transaction });
  });
}

// Lookup acotado para el picker de asignacion de activos (Fase E, paso 9):
// NO se expone GET /users?personId= de forma general -users:read es
// admin-only por diseno (PII, ver permission-catalog.ts). En vez de eso,
// este lookup vive detras del mismo permiso que ya exige completar la
// accion (asset-movements:create), acotado a Users activos, y solo por
// busqueda explicita (nunca devuelve el listado completo sin filtro).
export async function listAssignableUsers(search: string): Promise<SafeUser[]> {
  const trimmed = search.trim();
  if (!trimmed) return [];
  const users = await UserModel.findAll({
    where: { isActive: true },
    include: [
      {
        model: PersonModel,
        as: "person",
        required: true,
        where: {
          [Op.or]: [
            { documentId: { [Op.like]: `%${trimmed}%` } },
            { firstName: { [Op.like]: `%${trimmed}%` } },
            { lastName: { [Op.like]: `%${trimmed}%` } },
          ],
        },
      },
    ],
    order: [["username", "ASC"]],
    limit: 20,
  });
  return users.map(toSafeUser);
}

// Coincidencia EXACTA por RUT de un usuario activo (picker de la toma de inventario). Devuelve solo lo
// necesario para mostrar y asignar; no expone el resto de los datos personales.
export async function findActiveUserByDocumentId(
  documentId: string,
): Promise<{ userId: number; fullName: string } | null> {
  const user = await UserModel.findOne({
    where: { isActive: true },
    include: [{ model: PersonModel, as: "person", required: true, where: { documentId: documentId.trim() } }],
  });
  if (!user?.person) return null;
  return { userId: user.id, fullName: `${user.person.firstName} ${user.person.lastName}`.trim() };
}

// Batch para la carga masiva por CSV: solo usuarios ACTIVOS, por username o por RUT exacto (mismo criterio que el
// picker de la toma). Devuelve el id de cada uno con la clave con que se pidio (username en minusculas / RUT tal cual
// esta registrado), sin datos personales.
export async function findActiveUserIdsByUsernames(usernames: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(usernames)];
  const result = new Map<string, number>();
  if (unique.length === 0) return result;
  const users = await UserModel.findAll({ where: { isActive: true, username: { [Op.in]: unique } } });
  for (const user of users) result.set(user.username.toLowerCase(), user.id);
  return result;
}

export async function findActiveUserIdsByDocumentIds(documentIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(documentIds)];
  const result = new Map<string, number>();
  if (unique.length === 0) return result;
  const users = await UserModel.findAll({
    where: { isActive: true },
    include: [{ model: PersonModel, as: "person", required: true, where: { documentId: { [Op.in]: unique } } }],
  });
  for (const user of users) {
    if (user.person) result.set(user.person.documentId, user.id);
  }
  return result;
}

export async function deactivateUser(id: number): Promise<void> {
  const user = await getUserByIdOrThrow(id);
  await user.update({ isActive: false });
}

export async function touchLastLogin(id: number): Promise<void> {
  await UserModel.update({ lastLoginAt: new Date() }, { where: { id } });
}
