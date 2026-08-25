import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as assetService from "../services/postgres/asset.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

// Sin endpoint de creacion directa: un Asset nace SOLO al confirmar un
// GoodsReceipt (ver services/mssql/goodsReceipt.service.ts) -crearlo suelto
// no tendria de donde sacar el tag/productType.
export const updateAssetSchema = z.object({
  serialNumber: z.string().max(100).optional(),
  warrantyExpiresAt: z.string().date().optional(),
  value: z.number().optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id", "desc");
    const goodsReceiptId = req.query.goodsReceiptId ? Number(req.query.goodsReceiptId) : undefined;
    const { items, total } = await assetService.listAssets(params, goodsReceiptId);
    sendList(res, items, buildPaginationMeta(params, total), "Activos obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const asset = await assetService.getAssetByIdOrThrow(Number(req.params.id));
    sendOk(res, asset, "Activo obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateAssetSchema>;
    const asset = await assetService.updateAsset(Number(req.params.id), {
      ...body,
      value: body.value !== undefined ? String(body.value) : undefined,
      updatedBy: req.user?.userId,
    });
    sendOk(res, asset, "Activo actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}
