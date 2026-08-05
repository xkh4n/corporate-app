import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as goodsReceiptService from "../services/mssql/goodsReceipt.service";
import { BadRequestError } from "../library/errors";

export const createGoodsReceiptSchema = z.object({
  documentType: z.enum(["GUIA_DESPACHO", "BOLETA", "FACTURA"]),
  documentNumber: z.string().min(1).max(50),
  purchaseOrderId: z.number().int().positive(),
  receivedQuantity: z.number().int().positive(),
  serialNumber: z.string().max(100).optional(),
  warrantyExpiresAt: z.string().date().optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.query.purchaseOrderId) throw new BadRequestError("Debe indicar purchaseOrderId como query param");
    res.json(await goodsReceiptService.listGoodsReceiptsByOrder(Number(req.query.purchaseOrderId)));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await goodsReceiptService.getGoodsReceiptByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createGoodsReceiptSchema>;
    res
      .status(201)
      .json(await goodsReceiptService.createGoodsReceipt({ ...body, createdBy: req.user?.userId }));
  } catch (err) {
    next(err);
  }
}
