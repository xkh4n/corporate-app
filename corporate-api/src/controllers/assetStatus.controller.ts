import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as assetStatusService from "../services/postgres/assetStatus.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createAssetStatusSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  description: z.string().max(255).optional(),
});

export const updateAssetStatusSchema = createAssetStatusSchema.omit({ code: true }).partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await assetStatusService.listAssetStatuses(params);
    sendList(res, items, buildPaginationMeta(params, total), "Estados de activo obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = await assetStatusService.getAssetStatusByIdOrThrow(Number(req.params.id));
    sendOk(res, status, "Estado de activo obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createAssetStatusSchema>;
    const status = await assetStatusService.createAssetStatus({ ...body, createdBy: req.user?.userId });
    sendOk(res, status, "Estado de activo creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateAssetStatusSchema>;
    const status = await assetStatusService.updateAssetStatus(Number(req.params.id), {
      ...body,
      updatedBy: req.user?.userId,
    });
    sendOk(res, status, "Estado de activo actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}
