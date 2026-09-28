import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Op } from "sequelize";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../test/setupIntegration";
import { env } from "../library/env";
import { RoleModel } from "../models/postgres/role.model";
import { PositionModel } from "../models/mongo/position.model";
import { EmployeeContractModel } from "../models/mssql/employeeContract.model";
import { EmployeePrevisionalProfileModel } from "../models/mssql/employeePrevisionalProfile.model";
import { AddressModel } from "../models/mssql/address.model";
import { getAssignedPermissionsForRole } from "../services/postgres/permission.service";
import { getEmployeeByPersonId } from "../services/mssql/employee.service";
import { getUserByUsername } from "../services/mssql/user.service";
import { getEmployerSettings } from "../services/mssql/previredSettings.service";
import { getPayrollSettings } from "../services/mssql/payrollSettings.service";
import { createCostCenter, getCostCenterByCode } from "../services/postgres/costCenter.service";
import { seedTestData } from "./seedTestData";

// Plan 014: siembra de datos de prueba, con datos ficticios (los reales viven fuera de git).
const PREFIX = "1110-test-seed-";
const RESET_TABLES = {
  mssql: [
    "password_history",
    "users",
    "employee_previsional_profiles",
    "employee_contracts",
    "employees",
    "addresses",
    "persons",
    "previred_employer_settings",
    "payroll_settings",
  ],
  mongo: ["Position"],
};

const file = path.join(os.tmpdir(), `seed_test_data_${process.pid}.json`);
const previousVar = process.env[env.seedTestDataFileVar];

function employee(documentId: string, username: string, afpCode: string) {
  return {
    person: {
      firstName: "NOMBRE",
      lastName: `APELLIDO ${username}`,
      maternalLastName: "MATERNO",
      sex: "F",
      nationality: 0,
      documentId,
      email: `${username}@example.com`,
      phone: null,
      birthDate: null,
    },
    address: { addressType: "PARTICULAR", addressLine: "CALLE 1", stateTerritorialCode: "13101" },
    employeeCode: `EMP${documentId.split("-")[0]}`,
    costCenterCode: 1110,
    positionTitle: "Cargo semilla de prueba",
    username,
    contract: {
      contractType: "INDEFINIDO",
      startDate: "2026-01-02",
      endDate: null,
      baseSalary: 1200000,
      gratificationType: "ART50",
      gratificationMethod: "PORCENTAJE_REMUNERACIONES",
      gratificationPercentage: 25,
      gratificationCapType: "IMM",
      gratificationCapFactor: 4.75,
      gratificationPaymentMode: "ANTICIPO_MENSUAL_RELIQUIDACION",
      gratificationSettlementMonth: 12,
      gratificationMonthlyAdvance: 216000,
      gratificationAdjustAdvancesCpi: true,
    },
    previsional: {
      regime: "AFP",
      workerType: 0,
      afpCode,
      healthCode: "FONASA",
      healthFun: null,
      healthPlanCurrency: null,
      healthAgreedAmount: null,
    },
  };
}

const DATA = {
  version: 1,
  roles: [
    {
      name: `${PREFIX}rol`,
      description: "Rol de la prueba de semilla",
      permissions: ["asset-assignment:access", "generate-ticket:access", "no-existe:access"],
    },
  ],
  positions: [
    {
      title: "Cargo semilla de prueba",
      description: "Cargo de la prueba de semilla",
      responsibilities: ["Probar"],
      technicalSkills: [],
      softSkills: [],
      reportsTo: null,
      supervises: null,
      roleName: `${PREFIX}rol`,
    },
  ],
  company: {
    ccaf: "CCAF_LOS_ANDES",
    mutual: "MUTUAL_ACHS",
    mutualBranchCode: 1,
    workAccidentRate: 0.3,
    gratificationSystem: "ART50",
    monthlyAdvancePercentage: 18,
  },
  employees: [employee("11111111-1", "tseeduno", "AFP_CAPITAL"), employee("22222222-2", "tseeddos", "AFP_HABITAT")],
};

async function cleanup() {
  await resetTestData(RESET_TABLES);
  await RoleModel.destroy({ where: { name: { [Op.like]: `${PREFIX}%` } } });
}

beforeEach(async () => {
  await cleanup();
  // En un arranque real seedCostCenters lo siembra antes; en Testing otras suites vacian cost_centers.
  if (!(await getCostCenterByCode(1110))) await createCostCenter({ code: 1110, name: "SISTEMAS" });
  fs.writeFileSync(file, JSON.stringify(DATA));
  process.env[env.seedTestDataFileVar] = file;
});

afterEach(async () => {
  await cleanup();
  fs.rmSync(file, { force: true });
});

afterAll(() => {
  if (previousVar === undefined) delete process.env[env.seedTestDataFileVar];
  else process.env[env.seedTestDataFileVar] = previousVar;
});

describe("datos de prueba (plan 014, integracion)", () => {
  it("siembra roles, cargos, empresa y colaboradores completos, y repetirlo no duplica nada", async () => {
    await seedTestData();
    await seedTestData();

    const role = await RoleModel.findOne({ where: { name: `${PREFIX}rol` } });
    expect(role).not.toBeNull();
    const keys = (await getAssignedPermissionsForRole(role!.id)).map((p) => `${p.resource}:${p.action}`).sort();
    expect(keys).toEqual(["asset-assignment:access", "generate-ticket:access"]);

    const positions = await PositionModel.find({ title: "Cargo semilla de prueba" });
    expect(positions).toHaveLength(1);
    expect(positions[0]!.roleId).toBe(role!.id);

    expect((await getEmployerSettings())?.mutualBranchCode).toBe(1);
    expect((await getPayrollSettings())?.gratificationSystem).toBe("ART50");

    for (const username of ["tseeduno", "tseeddos"]) {
      const user = await getUserByUsername(username);
      expect(user).not.toBeNull();
      expect(user!.roleId).toBe(role!.id);
      expect(user!.mustChangePassword).toBe(true);
      const emp = await getEmployeeByPersonId(user!.personId);
      expect(emp).not.toBeNull();
      expect(await EmployeeContractModel.count({ where: { employeeId: emp!.id } })).toBe(1);
      expect(await EmployeePrevisionalProfileModel.count({ where: { employeeId: emp!.id } })).toBe(1);
      expect(await AddressModel.count({ where: { personId: user!.personId } })).toBe(1);
    }
  });

  it("un archivo vacio o invalido no siembra nada ni tumba el arranque", async () => {
    fs.writeFileSync(file, "");
    await expect(seedTestData()).resolves.toBeUndefined();
    fs.writeFileSync(file, JSON.stringify({ ...DATA, version: 2 }));
    await expect(seedTestData()).resolves.toBeUndefined();
    expect(await RoleModel.count({ where: { name: { [Op.like]: `${PREFIX}%` } } })).toBe(0);
  });
});
