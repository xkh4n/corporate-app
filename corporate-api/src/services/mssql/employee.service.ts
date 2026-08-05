import { EmployeeModel } from "../../models/mssql/employee.model";
import { PersonModel } from "../../models/mssql/person.model";
import { getPersonByIdOrThrow } from "./person.service";
import { getCostCenterByIdOrThrow } from "../postgres/costCenter.service";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { EmployeeCreationAttributes, EmployeeUpdateAttributes } from "../../types/mssql/employee.types";

export async function listEmployees(): Promise<EmployeeModel[]> {
  return EmployeeModel.findAll({ include: [{ model: PersonModel, as: "person" }] });
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
