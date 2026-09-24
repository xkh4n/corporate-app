import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as assetAccountingService from "../services/postgres/assetAccounting.service";
import * as assetDepreciationService from "../services/postgres/assetDepreciation.service";
import * as policyService from "../services/postgres/assetAccountingPolicy.service";
import { BadRequestError, UnauthorizedError } from "../library/errors";
import { buildPaginationMeta, parsePaginationParams } from "../library/pagination";
import { sendList, sendNoContent, sendOk } from "../library/response";

// Gestion contable de activos (plan 007). Montos: DECIMAL(18,2), tope holgado.
const MAX_AMOUNT = 999_999_999_999;
const PERIOD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Formato esperado: AAAA-MM");
const METHOD = z.enum(["LINEAR", "ACCELERATED"]);
const STAGES = ["CLASSIFIED", "COSTED", "CAPITALIZED", "DEPRECIATING", "FULLY_DEPRECIATED", "WRITTEN_OFF"] as const;
const CLASSIFICATIONS = ["FIXED_ASSET", "EXPENSE", "INVENTORY"] as const;

export const classifySchema = z.object({
  classification: z.enum(CLASSIFICATIONS),
  classId: z.number().int().positive().optional(),
  belowThresholdConfirmed: z.boolean().optional(),
});

export const addCostSchema = z.object({
  concept: z.string().trim().min(2).max(150),
  amount: z.number().min(0.01).max(MAX_AMOUNT),
  documentRef: z.string().trim().max(50).optional(),
});

export const capitalizeSchema = z.object({ depreciationStartPeriod: PERIOD.optional() });

export const depreciationParamsSchema = z
  .object({
    usefulLifeMonths: z.number().int().min(1).max(1200).optional(),
    depreciationMethod: METHOD.optional(),
    residualValue: z.number().min(0).max(MAX_AMOUNT).optional(),
    depreciationStartPeriod: PERIOD.optional(),
  })
  .strict();

export const closePeriodSchema = z.object({ period: PERIOD });

export const policySchema = z.object({ capitalizationThreshold: z.number().min(0).max(MAX_AMOUNT) });

export const createClassSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, "Codigo en mayusculas, numeros y guiones (ej. COMPUTER-EQUIPMENT)")
    .max(30),
  name: z.string().trim().min(2).max(100),
  usefulLifeMonths: z.number().int().min(1).max(1200),
  defaultMethod: METHOD,
  residualRate: z.number().min(0).max(0.9999),
  isActive: z.boolean().optional(),
});

export const updateClassSchema = createClassSchema.omit({ code: true }).partial().strict();

function requireUserId(req: Request): number {
  const userId = req.user?.userId;
  if (userId === undefined) throw new UnauthorizedError();
  return userId;
}

function assetIdParam(req: Request): number {
  const id = Number(req.params.assetId);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError("assetId invalido");
  return id;
}

function listParams(req: Request) {
  return parsePaginationParams({ ...req.query }, "id", "asc", { maxLimit: 200 });
}

// ---- /asset-accounting -----------------------------------------------------

export async function listPending(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = listParams(req);
    const { items, total } = await assetAccountingService.listPending(params);
    sendList(res, items, buildPaginationMeta(params, total), "Activos pendientes de clasificar obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function listRecords(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = listParams(req);
    const stages = (params.status ?? []).filter((stage): stage is (typeof STAGES)[number] =>
      (STAGES as readonly string[]).includes(stage),
    );
    const rawClassification = typeof req.query.classification === "string" ? req.query.classification : undefined;
    const classification = (CLASSIFICATIONS as readonly string[]).includes(rawClassification ?? "")
      ? (rawClassification as (typeof CLASSIFICATIONS)[number])
      : undefined;
    const { items, total } = await assetAccountingService.listRecords(params, { stages, classification });
    sendList(res, items, buildPaginationMeta(params, total), "Registros contables obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getRecord(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await assetAccountingService.getRecordOrThrow(assetIdParam(req)), "Registro contable obtenido");
  } catch (err) {
    next(err);
  }
}

export async function classify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof classifySchema>;
    const record = await assetAccountingService.classify(assetIdParam(req), body, requireUserId(req));
    sendOk(res, record, "Activo clasificado exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function listCosts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await assetAccountingService.listCosts(assetIdParam(req)), "Costos atribuibles obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function addCost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof addCostSchema>;
    const costs = await assetAccountingService.addCost(assetIdParam(req), body, requireUserId(req));
    sendOk(res, costs, "Costo atribuible agregado", 201);
  } catch (err) {
    next(err);
  }
}

export async function removeCost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const costId = Number(req.params.costId);
    if (!Number.isInteger(costId) || costId <= 0) throw new BadRequestError("costId invalido");
    await assetAccountingService.removeCost(assetIdParam(req), costId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

export async function confirmCost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const record = await assetAccountingService.confirmCost(assetIdParam(req), requireUserId(req));
    sendOk(res, record, "Costo fijado exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function capitalize(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof capitalizeSchema>;
    const record = await assetAccountingService.capitalize(assetIdParam(req), body, requireUserId(req));
    sendOk(res, record, "Activo capitalizado exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function updateDepreciation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof depreciationParamsSchema>;
    const record = await assetAccountingService.updateDepreciationParams(assetIdParam(req), body);
    sendOk(res, record, "Parametros de depreciacion actualizados");
  } catch (err) {
    next(err);
  }
}

export async function getSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await assetAccountingService.getSchedule(assetIdParam(req)), "Tabla de depreciacion obtenida");
  } catch (err) {
    next(err);
  }
}

// ---- /asset-depreciation-runs ---------------------------------------------

export async function listRuns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = listParams(req);
    const { items, total } = await assetDepreciationService.listRuns(params);
    sendList(res, items, buildPaginationMeta(params, total), "Cierres de depreciacion obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function previewNextClose(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await assetDepreciationService.previewNextClose(), "Vista previa del proximo cierre");
  } catch (err) {
    next(err);
  }
}

export async function getRun(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const run = await assetDepreciationService.getRunOrThrow(id);
    const lines = await assetDepreciationService.getRunLines(id);
    sendOk(res, { ...run, lines }, "Cierre de depreciacion obtenido");
  } catch (err) {
    next(err);
  }
}

export async function closePeriod(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { period } = req.body as z.infer<typeof closePeriodSchema>;
    const run = await assetDepreciationService.closePeriod(period, requireUserId(req));
    sendOk(res, run, `Periodo ${period} cerrado`, 201);
  } catch (err) {
    next(err);
  }
}

export async function voidRun(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const run = await assetDepreciationService.voidRun(Number(req.params.id), requireUserId(req));
    sendOk(res, run, `Cierre ${run.period} anulado`);
  } catch (err) {
    next(err);
  }
}

// ---- /asset-accounting-policy ---------------------------------------------

export async function getPolicy(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await policyService.getPolicy(), "Politica contable obtenida");
  } catch (err) {
    next(err);
  }
}

export async function updatePolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { capitalizationThreshold } = req.body as z.infer<typeof policySchema>;
    sendOk(res, await policyService.updatePolicy(capitalizationThreshold, requireUserId(req)), "Politica actualizada");
  } catch (err) {
    next(err);
  }
}

export async function listClasses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const includeInactive = req.query.includeInactive === "true";
    sendOk(res, await policyService.listClasses(includeInactive), "Clases contables obtenidas");
  } catch (err) {
    next(err);
  }
}

export async function createClass(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createClassSchema>;
    sendOk(res, await policyService.createClass(body), "Clase contable creada", 201);
  } catch (err) {
    next(err);
  }
}

export async function updateClass(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateClassSchema>;
    sendOk(res, await policyService.updateClass(Number(req.params.id), body), "Clase contable actualizada");
  } catch (err) {
    next(err);
  }
}
