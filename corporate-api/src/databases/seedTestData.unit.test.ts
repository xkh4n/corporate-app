import { describe, expect, it } from "vitest";
import { seedTestDataSchema } from "./seedTestData.schema";

// Datos ficticios: el archivo real (RUT, nombres) vive en corporate-secrets, fuera de git.
const sample = {
  version: 1,
  roles: [{ name: "1110-rol-prueba", description: "Rol de prueba", permissions: ["asset-assignment:access", "service-tickets:all_view"] }],
  positions: [
    {
      title: "Cargo de prueba",
      description: "Descripcion",
      responsibilities: ["Una"],
      technicalSkills: [],
      softSkills: [],
      reportsTo: null,
      supervises: null,
      roleName: "1110-rol-prueba",
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
  employees: [
    {
      person: {
        firstName: "NOMBRE",
        lastName: "APELLIDO",
        maternalLastName: null,
        sex: "F",
        nationality: 0,
        documentId: "11111111-1",
        email: "prueba@example.com",
        phone: null,
        birthDate: null,
      },
      address: { addressType: "PARTICULAR", addressLine: "CALLE 1", stateTerritorialCode: "13101" },
      employeeCode: "EMP11111111",
      costCenterCode: 1110,
      positionTitle: "Cargo de prueba",
      username: "nprueba",
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
        afpCode: "AFP_CAPITAL",
        healthCode: "FONASA",
        healthFun: null,
        healthPlanCurrency: null,
        healthAgreedAmount: null,
      },
    },
  ],
};

describe("seedTestDataSchema (plan 014)", () => {
  it("acepta el formato del archivo de datos de prueba", () => {
    expect(seedTestDataSchema.safeParse(sample).success).toBe(true);
  });

  it("rechaza un permiso mal escrito, un correo invalido o una version desconocida", () => {
    const badPermission = structuredClone(sample);
    badPermission.roles[0]!.permissions = ["Asset Assignment"];
    expect(seedTestDataSchema.safeParse(badPermission).success).toBe(false);

    const badEmail = structuredClone(sample);
    badEmail.employees[0]!.person.email = "no-es-correo";
    expect(seedTestDataSchema.safeParse(badEmail).success).toBe(false);

    expect(seedTestDataSchema.safeParse({ ...sample, version: 2 }).success).toBe(false);
  });
});
