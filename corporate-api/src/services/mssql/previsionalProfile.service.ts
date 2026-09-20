import { EmployeePrevisionalProfileModel } from "../../models/mssql/employeePrevisionalProfile.model";
import type {
  HealthPlanCurrency,
  PrevisionalRegime,
  PrevisionalWorkerType,
} from "../../models/mssql/employeePrevisionalProfile.model";
import { PreviredEmployerSettingsModel } from "../../models/mssql/previredEmployerSettings.model";
import { PrevisionalInstitutionModel } from "../../models/mssql/previsionalInstitution.model";
import { getEmployeeByIdOrThrow } from "./employee.service";
import { getInstitutionOfTypeOrThrow } from "./previsionalInstitution.service";
import { BadRequestError, isUniqueConstraintError } from "../../library/errors";

export interface PensionAssignment {
  regime: PrevisionalRegime;
  workerType: PrevisionalWorkerType;
  afpInstitutionId: number | null;
}

export interface HealthAssignment {
  healthInstitutionId: number;
  healthFun: string | null;
  healthPlanCurrency: HealthPlanCurrency | null;
  healthAgreedAmount: number | null;
}

// Codigo Previred de FONASA (Tabla 16). Se compara por codigo y no por nombre
// o por id: es el dato estable del catalogo.
const FONASA_PREVIRED_CODE = "07";
// Tope de la doc de Previred (campo 79): plan pactado superior a 100 UF se
// rechaza. En pesos no se puede validar aca sin el valor de la UF del periodo.
const MAX_AGREED_UF = 100;

const PROFILE_INCLUDE = [
  { model: PrevisionalInstitutionModel, as: "afp" },
  { model: PrevisionalInstitutionModel, as: "healthInstitution" },
];

async function findProfile(employeeId: number): Promise<EmployeePrevisionalProfileModel | null> {
  return EmployeePrevisionalProfileModel.findOne({ where: { employeeId }, include: PROFILE_INCLUDE });
}

// Lo que el colaborador HEREDA de la empresa: CCAF y mutual no se guardan por
// trabajador (ver previredEmployerSettings.model.ts), se leen de la fila unica
// de configuracion al armar cada linea de la nomina. Se expone junto al perfil
// para que la pantalla muestre el efecto real de esa configuracion.
export async function getEmployerInheritance() {
  const settings = await PreviredEmployerSettingsModel.findByPk(1, {
    include: [
      { model: PrevisionalInstitutionModel, as: "ccaf" },
      { model: PrevisionalInstitutionModel, as: "mutual" },
    ],
  });
  return {
    ccaf: settings?.ccaf ?? null,
    mutual: settings?.mutual ?? null,
    mutualBranchCode: settings?.mutualBranchCode ?? null,
    workAccidentRate: settings?.workAccidentRate ?? null,
  };
}

// profile es null hasta que se asigna la primera pieza (AFP o salud).
export async function getPrevisionalProfileView(employeeId: number) {
  await getEmployeeByIdOrThrow(employeeId);
  const [profile, employer] = await Promise.all([findProfile(employeeId), getEmployerInheritance()]);
  return { employeeId, profile, employer };
}

// El perfil nace con la primera asignacion, sea AFP o salud. Dos requests
// concurrentes sobre un colaborador sin perfil chocan en el UNIQUE(employee_id):
// quien pierde la carrera reintenta como actualizacion.
async function saveProfile(
  employeeId: number,
  values: Partial<EmployeePrevisionalProfileModel>,
  userId: number | undefined,
): Promise<void> {
  const update = async (): Promise<boolean> => {
    const existing = await EmployeePrevisionalProfileModel.findOne({ where: { employeeId } });
    if (!existing) return false;
    await existing.update({ ...values, updatedBy: userId ?? null });
    return true;
  };

  if (await update()) return;
  try {
    await EmployeePrevisionalProfileModel.create({
      employeeId,
      ...values,
      createdBy: userId ?? null,
      updatedBy: userId ?? null,
    } as never);
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    if (!(await update())) throw err;
  }
}

export async function assignPension(employeeId: number, data: PensionAssignment, userId?: number) {
  await getEmployeeByIdOrThrow(employeeId);

  // Solo el regimen AFP lleva AFP (campo 26 obligatorio ahi); en INP/SIP se
  // ignora lo que venga en vez de guardar una AFP que Previred rechazaria.
  let afpInstitutionId: number | null = null;
  if (data.regime === "AFP") {
    if (data.afpInstitutionId === null) {
      throw new BadRequestError("El regimen AFP requiere seleccionar una AFP");
    }
    await getInstitutionOfTypeOrThrow(data.afpInstitutionId, "AFP");
    afpInstitutionId = data.afpInstitutionId;
  }

  await saveProfile(
    employeeId,
    { regime: data.regime, workerType: data.workerType, afpInstitutionId },
    userId,
  );
  return getPrevisionalProfileView(employeeId);
}

export async function assignHealth(employeeId: number, data: HealthAssignment, userId?: number) {
  await getEmployeeByIdOrThrow(employeeId);
  const institution = await getInstitutionOfTypeOrThrow(data.healthInstitutionId, "SALUD");

  // FONASA no tiene plan pactado (7% de la renta); una isapre si, y sin moneda
  // y monto no se puede calcular la cotizacion adicional (campos 78 a 81).
  if (institution.previredCode === FONASA_PREVIRED_CODE) {
    await saveProfile(
      employeeId,
      {
        healthInstitutionId: institution.id,
        healthFun: null,
        healthPlanCurrency: null,
        healthAgreedAmount: null,
      },
      userId,
    );
  } else {
    if (data.healthPlanCurrency === null || data.healthAgreedAmount === null) {
      throw new BadRequestError("Una Isapre requiere moneda y monto del plan pactado");
    }
    if (data.healthPlanCurrency === 2 && data.healthAgreedAmount > MAX_AGREED_UF) {
      throw new BadRequestError(`El plan pactado no puede superar ${MAX_AGREED_UF} UF`);
    }
    await saveProfile(
      employeeId,
      {
        healthInstitutionId: institution.id,
        healthFun: data.healthFun,
        healthPlanCurrency: data.healthPlanCurrency,
        healthAgreedAmount: data.healthAgreedAmount,
      },
      userId,
    );
  }
  return getPrevisionalProfileView(employeeId);
}
