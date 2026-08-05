import { Op, type WhereOptions } from "sequelize";
import { EmployeeModel } from "../../models/mssql/employee.model";
import { PersonModel } from "../../models/mssql/person.model";
import { getPersonByIdOrThrow } from "./person.service";
import { getCostCenterByIdOrThrow } from "../postgres/costCenter.service";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { EmployeeCreationAttributes, EmployeeUpdateAttributes } from "../../types/mssql/employee.types";

const SEARCH_FIELDS = ["employeeCode"];

// documentId/name viven en la persona asociada, no en employees -a
// diferencia de SEARCH_FIELDS (que solo busca employeeCode), estos se
// resuelven via el join a PersonModel. Mismo criterio exacto-vs-LIKE que
// person.service.ts.
export interface EmployeeSearchFilters {
  documentId?: string;
  name?: string;
}

function buildPersonFilterConditions(filters: EmployeeSearchFilters): WhereOptions[] {
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

export async function listEmployees(
  params: PaginationParams,
  filters: EmployeeSearchFilters = {},
): Promise<{ items: EmployeeModel[]; total: number }> {
  const personConditions = buildPersonFilterConditions(filters);
  const personWhere: WhereOptions | undefined =
    personConditions.length > 0 ? { [Op.and]: personConditions } : undefined;

  const { rows, count } = await EmployeeModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: [
      personWhere
        ? { model: PersonModel, as: "person", where: personWhere, required: true }
        : { model: PersonModel, as: "person" },
    ],
  });
  return { items: rows, total: count };
}

export async function getEmployeeById(id: number): Promise<EmployeeModel | null> {
  return EmployeeModel.findByPk(id, { include: [{ model: PersonModel, as: "person" }] });
}

export async function getEmployeeByIdOrThrow(id: number): Promise<EmployeeModel> {
  const employee = await getEmployeeById(id);
  if (!employee) throw new NotFoundError(`El colaborador ${id} no existe`);
  return employee;
}

export async function getEmployeeByPersonId(personId: number): Promise<EmployeeModel | null> {
  return EmployeeModel.findOne({ where: { personId } });
}

// personId debe existir en persons (mismo motor, FK real). costCenterId es
// cross-engine hacia Postgres -sin FK real, validado a mano aca- (ver
// memoria project-erp-scope-and-data-classification).
export async function createEmployee(data: EmployeeCreationAttributes): Promise<EmployeeModel> {
  await getPersonByIdOrThrow(data.personId);
  await getCostCenterByIdOrThrow(data.costCenterId);

  const existing = await getEmployeeByPersonId(data.personId);
  if (existing) throw new ConflictError(`La persona ${data.personId} ya es colaborador`);

  const employee = await EmployeeModel.create(data);
  return getEmployeeByIdOrThrow(employee.id);
}

export async function updateEmployee(id: number, data: EmployeeUpdateAttributes): Promise<EmployeeModel> {
  const employee = await getEmployeeByIdOrThrow(id);
  if (data.costCenterId !== undefined) {
    await getCostCenterByIdOrThrow(data.costCenterId);
  }
  await employee.update(data);
  return employee;
}
