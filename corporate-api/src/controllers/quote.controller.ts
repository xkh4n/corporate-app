import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as quoteService from "../services/mssql/quote.service";
import { BadRequestError } from "../library/errors";

export const createQuoteSchema = z.object({
  requestId: z.number().int().positive(),
  productId: z.string().length(24),
  supplierId: z.number().int().positive(),
  purchaseValue: z.number().positive(),
  purchaseUnit: z.string().max(20).optional(),
  storageUnit: z.string().max(20).optional(),
  productCode: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.query.requestId) throw new BadRequestError("Debe indicar requestId como query param");
    res.json(await quoteService.listQuotesByRequest(Number(req.query.requestId)));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await quoteService.getQuoteByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createQuoteSchema>;
    res.status(201).json(
      await quoteService.createQuote({
        ...body,
        purchaseValue: String(body.purchaseValue),
        createdBy: req.user?.userId,
      }),
    );
  } catch (err) {
    next(err);
  }
}
