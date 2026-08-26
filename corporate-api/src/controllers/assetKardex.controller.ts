import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as assetKardexService from "../services/postgres/assetKardex.service";
import { BadRequestError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

// Solo ADJUSTMENT/WRITE_OFF: ACQUISITION nace exclusivamente de
// createAssetsFromReceipt (asset.service.ts), nunca via este endpoint -no
// tiene sentido dar de alta un activo "a mano" en el Kardex sin que exista
// la recepcion que lo respalda.
export const createManualEntrySchema = z.object({
  assetId: z.number().int().positive(),
  entryType: z.enum(["ADJUSTMENT", "WRITE_OFF"]),
  amount: z.number().optional(),
  reference: z.string().max(50).optional(),
  notes: z.string().max(255).optional(),
});

export async function listByAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.query.assetId) throw new BadRequestError("Debe indicar assetId como query param");
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id", "desc");
    const { items, total } = await assetKardexService.listEntriesByAsset(Number(req.query.assetId), params);
    sendList(res, items, buildPaginationMeta(params, total), "Asientos de kardex obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function listByProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const balances = await assetKardexService.listBalanceByProduct();
    sendOk(res, balances, "Valorizacion por producto obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createManualEntrySchema>;
    const entry = await assetKardexService.createManualEntry({
      ...body,
      amount: body.amount !== undefined ? String(body.amount) : undefined,
      createdBy: req.user?.userId,
    });
    sendOk(res, entry, "Asiento de kardex registrado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}
