import fs from "node:fs";
import { ZodError } from "zod";
import { seedTestDataSchema, type SeedTestData } from "./seedTestData.schema";
import { env } from "../library/env";
import { logger } from "../library/logger";
import { isUniqueConstraintError } from "../library/errors";
import { PermissionModel } from "../models/postgres/permission.model";
import { PositionModel } from "../models/mongo/position.model";
import { PersonModel } from "../models/mssql/person.model";
import { AddressModel } from "../models/mssql/address.model";
import { EmployeePrevisionalProfileModel } from "../models/mssql/employeePrevisionalProfile.model";
import { StateModel } from "../models/mssql/state.model";
import { PrevisionalInstitutionModel } from "../models/mssql/previsionalInstitution.model";
import type { EmployeeContractType } from "../models/mssql/employeeContract.model";
import type { GratificationType } from "../models/mssql/payrollSettings.model";
import type {
  HealthPlanCurrency,
  PrevisionalRegime,
  PrevisionalWorkerType,
} from "../models/mssql/employeePrevisionalProfile.model";
import { createRole, getRoleByName } from "../services/postgres/role.service";
import { setRolePermissions } from "../services/postgres/permission.service";
import { getCostCenterByCode } from "../services/postgres/costCenter.service";
import { createPosition } from "../services/mongo/position.service";
import { createPerson } from "../services/mssql/person.service";
import { createAddress } from "../services/mssql/address.service";
import { createEmployee, getEmployeeByPersonId } from "../services/mssql/employee.service";
import { createContract, listContractsByEmployee, type EmployeeContractInput } from "../services/mssql/employeeContract.service";
import { assignHealth, assignPension } from "../services/mssql/previsionalProfile.service";
import { getEmployerSettings, saveEmployerSettings } from "../services/mssql/previredSettings.service";
import { getPayrollSettings, savePayrollSettings } from "../services/mssql/payrollSettings.service";
import { createUser, getUserByUsername } from "../services/mssql/user.service";

// Datos de prueba (plan 014): en dev y test, el primer arranque deja poblados los roles con sus
// permisos, los cargos, la configuracion de la empresa (CCAF/mutual, gratificacion) y los
// colaboradores de flujo-pruebas-limpias.txt, como si se hubieran creado desde Nuevo Ingreso.
// Los datos (RUT, nombres, correos) viven en corporate-secrets/<ambiente>/seed_test_data.json,
// fuera de git; solo compose.dev/test lo montan (SEED_TEST_DATA_FILE). Sin esa variable no hace
// nada, y en produccion se niega aunque exista.
// Idempotente por entidad: cada paso revisa si ya existe (rol por nombre, cargo por titulo,
// persona por RUT...), asi que se puede correr en cada arranque y con las 3 replicas a la vez.
// Nunca pisa lo que se haya cambiado a mano despues: los permisos de un rol solo se fijan al crearlo.

// Punto de entrada desde index.ts. Nunca tumba el arranque: un archivo invalido o un paso que
// falla se loguean y se sigue.
export async function seedTestData(): Promise<void> {
  const filePath = process.env[env.seedTestDataFileVar];
  if (!filePath) return;
  if (env.nodeEnv === "production") {
    logger.error(`${env.seedTestDataFileVar} esta definida en produccion: los datos de prueba NO se siembran`);
    return;
  }

  let data: SeedTestData;
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    // Vacio: ensure-backend-secrets lo crea asi cuando no hay datos de prueba en esa maquina.
    if (raw === "") return;
    data = seedTestDataSchema.parse(JSON.parse(raw));
  } catch (err) {
    // Sin el error completo: JSON.parse y Zod traen trozos del archivo (RUT, nombres) en el mensaje.
    const issues = err instanceof ZodError ? err.issues.map((i) => i.path.join(".")) : undefined;
    logger.error(
      { errName: err instanceof Error ? err.name : "unknown", issues },
      "Datos de prueba: el archivo no es valido, se omite la siembra",
    );
    return;
  }

  const adminId = (await getUserByUsername("admin"))?.id;
  await step("roles", () => seedRoles(data));
  await step("cargos", () => seedPositions(data));
  await step("empresa", () => seedCompany(data, adminId));
  for (const employee of data.employees) {
    await step(`colaborador ${employee.username}`, () => seedEmployee(employee, adminId));
  }
  logger.info("Datos de prueba revisados/sembrados");
}

async function step(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    logger.error({ err }, `Datos de prueba: fallo el paso "${name}"`);
  }
}

async function seedRoles(data: SeedTestData): Promise<void> {
  const catalog = await PermissionModel.findAll();
  const idByKey = new Map(catalog.map((permission) => [`${permission.resource}:${permission.action}`, permission.id]));

  for (const role of data.roles) {
    if (await getRoleByName(role.name)) continue;
    let created;
    try {
      created = await createRole({ name: role.name, description: role.description ?? undefined });
    } catch (err) {
      // Otra replica lo creo primero: ella fija sus permisos.
      if (await getRoleByName(role.name)) continue;
      throw err;
    }
    const missing = role.permissions.filter((key) => !idByKey.has(key));
    if (missing.length > 0) logger.warn(`Datos de prueba: el rol ${role.name} pide permisos inexistentes: ${missing.join(", ")}`);
    const ids = role.permissions.flatMap((key) => (idByKey.has(key) ? [idByKey.get(key)!] : []));
    await setRolePermissions(created.id, ids);
    logger.info(`Datos de prueba: rol ${role.name} creado con ${ids.length} permisos`);
  }
}

async function seedPositions(data: SeedTestData): Promise<void> {
  for (const position of data.positions) {
    if (await PositionModel.exists({ title: position.title })) continue;
    const role = await getRoleByName(position.roleName);
    if (!role) {
      logger.warn(`Datos de prueba: el cargo ${position.title} referencia el rol inexistente ${position.roleName}`);
      continue;
    }
    try {
      await createPosition({
        title: position.title,
        description: position.description,
        responsibilities: position.responsibilities,
        technicalSkills: position.technicalSkills,
        softSkills: position.softSkills,
        reportsTo: position.reportsTo,
        supervises: position.supervises,
        roleId: role.id,
      });
    } catch (err) {
      if (!(await PositionModel.exists({ title: position.title }))) throw err;
    }
  }
}

async function institutionId(code: string | null, type: string): Promise<number | null> {
  if (code === null) return null;
  const institution = await PrevisionalInstitutionModel.findOne({ where: { code, type } });
  if (!institution) throw new Error(`No existe la institucion ${type} ${code}`);
  return institution.id;
}

// Configuracion de la empresa: solo si todavia no esta hecha (la pantalla la puede cambiar despues).
async function seedCompany(data: SeedTestData, adminId: number | undefined): Promise<void> {
  const { company } = data;
  if (!(await getEmployerSettings())) {
    await saveEmployerSettings(
      {
        ccafInstitutionId: await institutionId(company.ccaf, "CCAF"),
        mutualInstitutionId: await institutionId(company.mutual, "MUTUAL"),
        mutualBranchCode: company.mutualBranchCode,
        workAccidentRate: company.workAccidentRate,
      } as Parameters<typeof saveEmployerSettings>[0],
      adminId,
    );
  }
  if (!(await getPayrollSettings())) {
    await savePayrollSettings(
      {
        gratificationSystem: company.gratificationSystem as GratificationType | null,
        gratificationMonthlyAdvancePercentage: company.monthlyAdvancePercentage,
      },
      adminId,
    );
  }
}

// Mismo orden que Nuevo Ingreso (CrearPersona.tsx): persona, direccion, colaborador, contrato,
// AFP, salud y usuario. Cada pieza se salta si ya existe, asi un arranque interrumpido se completa
// en el siguiente.
async function seedEmployee(employee: SeedTestData["employees"][number], adminId: number | undefined): Promise<void> {
  let person = await PersonModel.findOne({ where: { documentId: employee.person.documentId } });
  if (!person) {
    try {
      person = await createPerson(employee.person);
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      return; // otra replica lo esta creando
    }
  }

  if ((await AddressModel.count({ where: { personId: person.id } })) === 0) {
    const state = await StateModel.findOne({ where: { territorialCode: employee.address.stateTerritorialCode } });
    if (!state) throw new Error(`No existe la comuna ${employee.address.stateTerritorialCode}`);
    await createAddress({
      personId: person.id,
      addressType: employee.address.addressType,
      addressLine: employee.address.addressLine,
      stateId: state.id,
      createdBy: adminId,
    });
  }

  const position = await PositionModel.findOne({ title: employee.positionTitle });
  if (!position) throw new Error(`No existe el cargo ${employee.positionTitle}`);

  let employeeRow = await getEmployeeByPersonId(person.id);
  if (!employeeRow) {
    const costCenter = await getCostCenterByCode(employee.costCenterCode);
    if (!costCenter) throw new Error(`No existe el centro de costo ${employee.costCenterCode}`);
    employeeRow = await createEmployee({
      personId: person.id,
      employeeCode: employee.employeeCode,
      costCenterId: costCenter.id,
      positionId: String(position._id),
      createdBy: adminId,
    });
  }

  if ((await listContractsByEmployee(employeeRow.id)).length === 0) {
    await createContract(
      {
        ...employee.contract,
        employeeId: employeeRow.id,
        contractType: employee.contract.contractType as EmployeeContractType,
      } as EmployeeContractInput,
      adminId,
    );
  }

  const { previsional } = employee;
  const profile = await EmployeePrevisionalProfileModel.findOne({ where: { employeeId: employeeRow.id } });
  if (!profile?.regime) {
    await assignPension(
      employeeRow.id,
      {
        regime: previsional.regime as PrevisionalRegime,
        workerType: previsional.workerType as PrevisionalWorkerType,
        afpInstitutionId: await institutionId(previsional.afpCode, "AFP"),
      },
      adminId,
    );
  }
  if (!profile?.healthInstitutionId) {
    await assignHealth(
      employeeRow.id,
      {
        healthInstitutionId: (await institutionId(previsional.healthCode, "SALUD"))!,
        healthFun: previsional.healthFun,
        healthPlanCurrency: previsional.healthPlanCurrency as HealthPlanCurrency | null,
        healthAgreedAmount: previsional.healthAgreedAmount,
      },
      adminId,
    );
  }

  if (!(await getUserByUsername(employee.username))) {
    // Sin password: createUser aplica la password por defecto y exige cambiarla (igual que Nuevo Ingreso).
    await createUser({ personId: person.id, roleId: position.roleId, username: employee.username });
    logger.info(`Datos de prueba: colaborador ${employee.username} creado`);
  }
}
