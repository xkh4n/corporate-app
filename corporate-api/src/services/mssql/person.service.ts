import { Op, type WhereOptions } from "sequelize";
import { PersonModel } from "../../models/mssql/person.model";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type {
  PersonCreationAttributes,
  PersonUpdateAttributes,
} from "../../types/mssql/person.types";

const SEARCH_FIELDS = ["firstName", "lastName", "documentId", "email", "phone"];

// documentId/name son filtros puntuales (mas precisos que el "search"
// generico de arriba, que hace LIKE contra 5 campos a la vez): documentId
// es match EXACTO (es un identificador unico, no tiene sentido un LIKE
// parcial ahi -"12345678" no deberia matchear "112345678-9"), name es LIKE
// contra firstName/lastName. Se combinan con AND entre si y con "search" si
// tambien viene.
export interface PersonSearchFilters {
  documentId?: string;
  name?: string;
}

function buildPersonFilterConditions(filters: PersonSearchFilters): WhereOptions[] {
  const conditions: WhereOptions[] = [];
  if (filters.documentId) conditions.push({ documentId: filters.documentId });
  if (filters.name) {
    conditions.push({
      [Op.or]: [
        { firstName: { [Op.like]: `%${filters.name}%` } },
        { lastName: { [Op.like]: `%${filters.name}%` } },
      ],
    } as WhereOptions);
  }
  return conditions;
}

export async function listPersons(
  params: PaginationParams,
  filters: PersonSearchFilters = {},
): Promise<{ items: PersonModel[]; total: number }> {
  const conditions = buildPersonFilterConditions(filters);
  const searchWhere = buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like);
  if (Object.keys(searchWhere).length > 0) conditions.push(searchWhere);

  const { rows, count } = await PersonModel.findAndCountAll({
    where: conditions.length > 0 ? { [Op.and]: conditions } : {},
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getPersonById(id: number): Promise<PersonModel | null> {
  return PersonModel.findByPk(id);
}

export async function getPersonByIdOrThrow(id: number): Promise<PersonModel> {
  const person = await getPersonById(id);
  if (!person) throw new NotFoundError(`La persona ${id} no existe`);
  return person;
}

async function assertUnique(
  documentId: string,
  email: string,
  excludeId?: number,
): Promise<void> {
  const where = excludeId
    ? { [Op.and]: [{ [Op.or]: [{ documentId }, { email }] }, { id: { [Op.ne]: excludeId } }] }
    : { [Op.or]: [{ documentId }, { email }] };

  const existing = await PersonModel.findOne({ where });
  if (existing) {
    const field = existing.documentId === documentId ? "documentId" : "email";
    throw new ConflictError(`Ya existe una persona con ese ${field}`, { field });
  }
}

export async function createPerson(data: PersonCreationAttributes): Promise<PersonModel> {
  await assertUnique(data.documentId, data.email);
  return PersonModel.create(data);
}

export async function updatePerson(
  id: number,
  data: PersonUpdateAttributes,
): Promise<PersonModel> {
  const person = await getPersonByIdOrThrow(id);
  if (data.documentId || data.email) {
    await assertUnique(data.documentId ?? person.documentId, data.email ?? person.email, id);
  }
  await person.update(data);
  return person;
}

export async function deactivatePerson(id: number): Promise<void> {
  const person = await getPersonByIdOrThrow(id);
  await person.update({ isActive: false });
}
