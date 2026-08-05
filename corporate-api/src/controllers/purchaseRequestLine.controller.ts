import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as lineService from "../services/mssql/purchaseRequestLine.service";
import { BadRequestError } from "../library/errors";

export const createLineSchema = z.object({
  requestId: z.number().int().positive(),
  productId: z.string().length(24),
  quantity: z.number().int().positive(),
  equipmentType: z.string().max(100).optional(),
  supplierId: z.number().int().positive().optional(),
});

export const updateLineSchema = z.object({
  equipmentType: z.string().max(100).optional(),
  supplierId: z.number().int().positive().optional(),
  quantity: z.number().int().positive().optional(),
  status: z.string().max(20).optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.query.requestId) throw new BadRequestError("Debe indicar requestId como query param");
    res.json(await lineService.listLinesByRequest(Number(req.query.requestId)));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await lineService.getLineByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createLineSchema>;
    res.status(201).json(await lineService.createLine({ ...body, createdBy: req.user?.userId }));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateLineSchema>;
    res.json(await lineService.updateLine(Number(req.params.id), body));
  } catch (err) {
    next(err);
  }
}
