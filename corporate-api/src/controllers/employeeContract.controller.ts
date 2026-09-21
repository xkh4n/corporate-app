import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as contractService from "../services/mssql/employeeContract.service";
import { sendOk } from "../library/response";
import { BadRequestError } from "../library/errors";

const isoDate = z.string().date();

// Espejo de las reglas de las CHECK de employee_contracts: si la API acepta algo
// que la BD rechaza, el usuario recibiria un 500 en vez de un mensaje claro.
export const createContractSchema = z
  .object({
    employeeId: z.number().int().positive(),
    contractType: z.enum(["INDEFINIDO", "PLAZO_FIJO"]),
    startDate: isoDate,
    endDate: isoDate.nullable(),
    baseSalary: z.number().int().positive().max(99_999_999),
    gratificationType: z.enum(["ART47", "ART50", "CONVENCIONAL"]),
    gratificationMethod: z.enum(["PORCENTAJE_REMUNERACIONES", "PARTICIPACION_UTILIDADES"]),
    gratificationPercentage: z.number().positive().max(100),
    gratificationCapType: z.literal("IMM").nullable(),
    gratificationCapFactor: z.number().positive().max(999).nullable(),
    gratificationPaymentMode: z.enum(["MENSUAL", "ANTICIPO_MENSUAL_RELIQUIDACION", "ANUAL"]),
    gratificationSettlementMonth: z.number().int().min(1).max(12).nullable(),
    gratificationMonthlyAdvance: z.number().int().positive().nullable(),
    gratificationAdjustAdvancesCpi: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if ((data.gratificationCapType === null) !== (data.gratificationCapFactor === null)) {
      ctx.addIssue({ code: "custom", path: ["gratificationCapFactor"], message: "El tope requiere tipo y factor" });
    }
    const monthly = data.gratificationPaymentMode === "MENSUAL";
    if (monthly && data.gratificationSettlementMonth !== null) {
      ctx.addIssue({ code: "custom", path: ["gratificationSettlementMonth"], message: "El pago mensual no lleva mes de reliquidacion" });
    }
    if (!monthly && data.gratificationSettlementMonth === null) {
      ctx.addIssue({ code: "custom", path: ["gratificationSettlementMonth"], message: "Falta el mes de reliquidacion o de pago" });
    }
    const advances = data.gratificationPaymentMode === "ANTICIPO_MENSUAL_RELIQUIDACION";
    if (advances && data.gratificationMonthlyAdvance === null) {
      ctx.addIssue({ code: "custom", path: ["gratificationMonthlyAdvance"], message: "Falta el monto del anticipo mensual" });
    }
    if (!advances && data.gratificationMonthlyAdvance !== null) {
      ctx.addIssue({ code: "custom", path: ["gratificationMonthlyAdvance"], message: "Solo los anticipos mensuales llevan monto de anticipo" });
    }
    if (data.gratificationAdjustAdvancesCpi && data.gratificationPaymentMode !== "ANTICIPO_MENSUAL_RELIQUIDACION") {
      ctx.addIssue({ code: "custom", path: ["gratificationAdjustAdvancesCpi"], message: "Solo se reajusta por IPC con anticipos y reliquidacion" });
    }
  });

// GET /employee-contracts?employeeId=N -> contratos del colaborador, el mas reciente primero.
export async function listByEmployee(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = z.coerce.number().int().positive().safeParse(req.query.employeeId);
    if (!parsed.success) throw new BadRequestError("Falta el employeeId");
    const contracts = await contractService.listContractsByEmployee(parsed.data);
    sendOk(res, contracts, "Contratos obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createContractSchema>;
    const contract = await contractService.createContract(body, req.user?.userId);
    sendOk(res, contract, "Contrato creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}
