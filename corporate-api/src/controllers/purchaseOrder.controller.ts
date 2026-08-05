import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as purchaseOrderService from "../services/mssql/purchaseOrder.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createPurchaseOrderSchema = z.object({
  quoteId: z.number().int().positive(),
  paymentTerms: z.string().max(50).optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id", "desc");
    const { items, total } = await purchaseOrderService.listPurchaseOrders(params);
    sendList(res, items, buildPaginationMeta(params, total), "Ordenes de compra obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const order = await purchaseOrderService.getPurchaseOrderByIdOrThrow(Number(req.params.id));
    sendOk(res, order, "Orden de compra obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createPurchaseOrderSchema>;
    const order = await purchaseOrderService.createPurchaseOrder({ ...body, createdBy: req.user?.userId });
    sendOk(res, order, "Orden de compra creada exitosamente", 201);
  } catch (err) {
    next(err);
  }
}
