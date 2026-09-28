import { z } from "zod";

// Formato de corporate-secrets/<ambiente>/seed_test_data.json (plan 014). Aparte de seedTestData.ts
// para poder validarlo sin conexiones a las bases.
const nullableString = z.string().nullable();

export const seedTestDataSchema = z.object({
  version: z.literal(1),
  roles: z.array(
    z.object({
      name: z.string().min(2).max(50),
      description: z.string().max(255).nullable(),
      permissions: z.array(z.string().regex(/^[a-z0-9-]+:[a-z_]+$/)),
    }),
  ),
  positions: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      responsibilities: z.array(z.string()),
      technicalSkills: z.array(z.string()),
      softSkills: z.array(z.string()),
      reportsTo: nullableString,
      supervises: nullableString,
      roleName: z.string(),
    }),
  ),
  company: z.object({
    ccaf: nullableString,
    mutual: nullableString,
    mutualBranchCode: z.number().int().nullable(),
    workAccidentRate: z.number(),
    gratificationSystem: nullableString,
    monthlyAdvancePercentage: z.number().nullable(),
  }),
  employees: z.array(
    z.object({
      person: z.object({
        firstName: z.string(),
        lastName: z.string(),
        maternalLastName: nullableString,
        sex: z.enum(["M", "F"]).nullable(),
        nationality: z.union([z.literal(0), z.literal(1)]).nullable(),
        documentId: z.string(),
        email: z.string().email(),
        phone: nullableString,
        birthDate: nullableString,
      }),
      address: z.object({ addressType: z.string(), addressLine: z.string(), stateTerritorialCode: z.string() }),
      employeeCode: z.string(),
      costCenterCode: z.number().int(),
      positionTitle: z.string(),
      username: z.string().min(3),
      contract: z.object({
        contractType: z.enum(["INDEFINIDO", "PLAZO_FIJO"]),
        startDate: z.string(),
        endDate: nullableString,
        baseSalary: z.number(),
        gratificationType: z.string(),
        gratificationMethod: z.string(),
        gratificationPercentage: z.number(),
        gratificationCapType: nullableString,
        gratificationCapFactor: z.number().nullable(),
        gratificationPaymentMode: z.string(),
        gratificationSettlementMonth: z.number().int().nullable(),
        gratificationMonthlyAdvance: z.number().nullable(),
        gratificationAdjustAdvancesCpi: z.boolean(),
      }),
      previsional: z.object({
        regime: z.enum(["AFP", "INP", "SIP"]),
        workerType: z.number().int(),
        afpCode: nullableString,
        healthCode: z.string(),
        healthFun: nullableString,
        healthPlanCurrency: z.number().int().nullable(),
        healthAgreedAmount: z.number().nullable(),
      }),
    }),
  ),
});

export type SeedTestData = z.infer<typeof seedTestDataSchema>;
