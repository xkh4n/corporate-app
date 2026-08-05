import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as costCenterService from "../services/postgres/costCenter.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createCostCenterSchema = z.object({
  code: z.number().int().positive(),
  name: z.string().min(1).max(150),
  description: z.string().max(255).optional(),
});

export const updateCostCenterSchema = createCostCenterSchema.omit({ code: true }).partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "name");
    const { items, total } = await costCenterService.listCostCenters(params);
    sendList(res, items, buildPaginationMeta(params, total), "Centros de costo obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const costCenter = await costCenterService.getCostCenterByIdOrThrow(Number(req.params.id));
    sendOk(res, costCenter, "Centro de costo obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createCostCenterSchema>;
    const costCenter = await costCenterService.createCostCenter({ ...body, createdBy: req.user?.userId });
    sendOk(res, costCenter, "Centro de costo creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateCostCenterSchema>;
    const costCenter = await costCenterService.updateCostCenter(Number(req.params.id), body);
    sendOk(res, costCenter, "Centro de costo actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}
