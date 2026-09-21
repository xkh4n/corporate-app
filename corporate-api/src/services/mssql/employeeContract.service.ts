import { Op } from "sequelize";
import { EmployeeContractModel } from "../../models/mssql/employeeContract.model";
import type {
  EmployeeContractType,
  GratificationCapType,
  GratificationMethod,
  GratificationPaymentMode,
} from "../../models/mssql/employeeContract.model";
import type { GratificationType } from "../../models/mssql/payrollSettings.model";
import { getEmployeeByIdOrThrow } from "./employee.service";
import { BadRequestError, ConflictError, isUniqueConstraintError } from "../../library/errors";
import { assertGratificationRules } from "../../library/gratificationRules";

export interface EmployeeContractInput {
  employeeId: number;
  contractType: EmployeeContractType;
  startDate: string;
  endDate: string | null;
  baseSalary: number;
  gratificationType: GratificationType;
  gratificationMethod: GratificationMethod;
  gratificationPercentage: number;
  gratificationCapType: GratificationCapType | null;
  gratificationCapFactor: number | null;
  gratificationPaymentMode: GratificationPaymentMode;
  gratificationSettlementMonth: number | null;
  gratificationMonthlyAdvance: number | null;
  gratificationAdjustAdvancesCpi: boolean;
}

export async function listContractsByEmployee(employeeId: number): Promise<EmployeeContractModel[]> {
  await getEmployeeByIdOrThrow(employeeId);
  return EmployeeContractModel.findAll({ where: { employeeId }, order: [["startDate", "DESC"]] });
}

// Dos contratos del mismo colaborador no pueden cubrir el mismo dia: se
// solapan si cada uno empieza antes de que termine el otro (sin fecha de
// termino = abierto).
async function assertNoOverlap(employeeId: number, startDate: string, endDate: string | null): Promise<void> {
  const overlapping = await EmployeeContractModel.findOne({
    where: {
      employeeId,
      ...(endDate ? { startDate: { [Op.lte]: endDate } } : {}),
      [Op.or]: [{ endDate: null }, { endDate: { [Op.gte]: startDate } }],
    },
  });
  if (overlapping) {
    throw new ConflictError("El colaborador ya tiene un contrato que se solapa con esas fechas", {
      contractId: overlapping.id,
    });
  }
}

export async function createContract(data: EmployeeContractInput, userId?: number): Promise<EmployeeContractModel> {
  await getEmployeeByIdOrThrow(data.employeeId);
  assertGratificationRules(data);
  if (data.endDate !== null && data.endDate < data.startDate) {
    throw new BadRequestError("La fecha de termino no puede ser anterior a la de inicio");
  }
  if (data.contractType === "PLAZO_FIJO" && data.endDate === null) {
    throw new BadRequestError("Un contrato a plazo fijo requiere fecha de termino");
  }
  await assertNoOverlap(data.employeeId, data.startDate, data.endDate);

  try {
    return await EmployeeContractModel.create({ ...data, createdBy: userId ?? null, updatedBy: userId ?? null });
  } catch (err) {
    // Indice unico de contrato abierto: otra request creo uno entre el chequeo de arriba y el insert.
    if (isUniqueConstraintError(err)) {
      throw new ConflictError("El colaborador ya tiene un contrato vigente");
    }
    throw err;
  }
}
