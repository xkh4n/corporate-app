import { Op } from "sequelize";
import { PersonModel } from "../../models/mssql/person.model";
import { ConflictError, NotFoundError } from "../../library/errors";
import type {
  PersonCreationAttributes,
  PersonUpdateAttributes,
} from "../../types/mssql/person.types";

export async function listPersons(): Promise<PersonModel[]> {
  return PersonModel.findAll({ order: [["id", "ASC"]] });
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
