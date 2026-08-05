import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as assetStatusService from "../services/postgres/assetStatus.service";

export const createAssetStatusSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  description: z.string().max(255).optional(),
});

export const updateAssetStatusSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(255).optional(),
});

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await assetStatusService.listAssetStatuses());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await assetStatusService.getAssetStatusByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createAssetStatusSchema>;
    res.status(201).json(await assetStatusService.createAssetStatus({ ...body, createdBy: req.user?.userId }));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateAssetStatusSchema>;
    res.json(await assetStatusService.updateAssetStatus(Number(req.params.id), body));
  } catch (err) {
    next(err);
  }
}
