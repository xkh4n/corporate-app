import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as quoteService from "../services/mssql/quote.service";
import { BadRequestError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

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
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await quoteService.listQuotesByRequest(Number(req.query.requestId), params);
    sendList(res, items, buildPaginationMeta(params, total), "Cotizaciones obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const quote = await quoteService.getQuoteByIdOrThrow(Number(req.params.id));
    sendOk(res, quote, "Cotizacion obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createQuoteSchema>;
    const quote = await quoteService.createQuote({
      ...body,
      purchaseValue: String(body.purchaseValue),
      createdBy: req.user?.userId,
    });
    sendOk(res, quote, "Cotizacion creada exitosamente", 201);
  } catch (err) {
    next(err);
  }
}
