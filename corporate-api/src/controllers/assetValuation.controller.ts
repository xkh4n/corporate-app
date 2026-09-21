import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as assetValuationService from "../services/postgres/assetValuation.service";
import { UnauthorizedError } from "../library/errors";
import { buildPaginationMeta, parsePaginationParams } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

// value >= 0.01: el 0 esta reservado a DEVALUATED (baja reactivada en uso) y un valor menor a un
// centavo redondearia a 0 al guardarse (DECIMAL(18,2)). El tope entra sobradamente en DECIMAL(18,2).
export const valueAssetsSchema = z.object({
  items: z
    .array(
      z.object({
        assetId: z.number().int().positive(),
        value: z.number().min(0.01).max(999_999_999_999),
      }),
    )
    .min(1)
    .max(200)
    .refine((items) => new Set(items.map((item) => item.assetId)).size === items.length, {
      message: "No repita un mismo activo en el lote",
    }),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id", "asc", {
      allowedSortBy: ["id", "tag", "serialNumber", "createdAt"],
      maxLimit: 200,
    });
    const { items, total } = await assetValuationService.listAssetsPendingValuation(params);
    sendList(res, items, buildPaginationMeta(params, total), "Activos pendientes de valorización obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

// Responde 200 con el resultado por activo (ok/error): un lote con fallos
// parciales no es un error de la request.
export async function valueBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (userId === undefined) throw new UnauthorizedError();
    const body = req.body as z.infer<typeof valueAssetsSchema>;
    const results = await assetValuationService.valueAssets(body.items, userId);
    sendOk(res, results, "Valorización procesada");
  } catch (err) {
    next(err);
  }
}
