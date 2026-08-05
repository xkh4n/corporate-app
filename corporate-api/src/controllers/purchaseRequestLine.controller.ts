import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as lineService from "../services/mssql/purchaseRequestLine.service";
import { BadRequestError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

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
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await lineService.listLinesByRequest(Number(req.query.requestId), params);
    sendList(res, items, buildPaginationMeta(params, total), "Lineas de solicitud obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const line = await lineService.getLineByIdOrThrow(Number(req.params.id));
    sendOk(res, line, "Linea de solicitud obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createLineSchema>;
    const line = await lineService.createLine({ ...body, createdBy: req.user?.userId });
    sendOk(res, line, "Linea de solicitud creada exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateLineSchema>;
    const line = await lineService.updateLine(Number(req.params.id), body);
    sendOk(res, line, "Linea de solicitud actualizada exitosamente");
  } catch (err) {
    next(err);
  }
}
