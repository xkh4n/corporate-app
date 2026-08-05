import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as assetService from "../services/postgres/asset.service";

// Sin endpoint de creacion directa: un Asset nace SOLO al confirmar un
// GoodsReceipt (ver services/mssql/goodsReceipt.service.ts) -crearlo suelto
// no tendria de donde sacar el tag/productType.
export const updateAssetSchema = z.object({
  serialNumber: z.string().max(100).optional(),
  warrantyExpiresAt: z.string().date().optional(),
  value: z.number().optional(),
});

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await assetService.listAssets());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await assetService.getAssetByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateAssetSchema>;
    res.json(
      await assetService.updateAsset(Number(req.params.id), {
        ...body,
        value: body.value !== undefined ? String(body.value) : undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}
