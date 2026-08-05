import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as costCenterService from "../services/postgres/costCenter.service";

export const createCostCenterSchema = z.object({
  code: z.number().int().positive(),
  name: z.string().min(1).max(150),
  description: z.string().max(255).optional(),
});

export const updateCostCenterSchema = createCostCenterSchema.omit({ code: true }).partial();

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await costCenterService.listCostCenters());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await costCenterService.getCostCenterByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createCostCenterSchema>;
    res.status(201).json(await costCenterService.createCostCenter({ ...body, createdBy: req.user?.userId }));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateCostCenterSchema>;
    res.json(await costCenterService.updateCostCenter(Number(req.params.id), body));
  } catch (err) {
    next(err);
  }
}
