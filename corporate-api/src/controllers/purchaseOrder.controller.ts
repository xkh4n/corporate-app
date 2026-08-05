import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as purchaseOrderService from "../services/mssql/purchaseOrder.service";

export const createPurchaseOrderSchema = z.object({
  quoteId: z.number().int().positive(),
  paymentTerms: z.string().max(50).optional(),
});

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await purchaseOrderService.listPurchaseOrders());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await purchaseOrderService.getPurchaseOrderByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createPurchaseOrderSchema>;
    res
      .status(201)
      .json(await purchaseOrderService.createPurchaseOrder({ ...body, createdBy: req.user?.userId }));
  } catch (err) {
    next(err);
  }
}
