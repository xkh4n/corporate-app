import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as assetMovementService from "../services/postgres/assetMovement.service";
import { listAssignableUsers } from "../services/mssql/user.service";
import { BadRequestError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createAssetMovementSchema = z.object({
  assetId: z.number().int().positive(),
  movementType: z.enum(["ASSIGNED", "REASSIGNED", "SUPPORT", "DECOMMISSIONED"]),
  userIds: z.array(z.number().int().positive()).optional(),
  notes: z.string().max(255).optional(),
});

export const assignAssetSchema = z.object({
  assetId: z.number().int().positive(),
  userId: z.number().int().positive(),
  notes: z.string().max(255).optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.query.assetId) throw new BadRequestError("Debe indicar assetId como query param");
    const params = parsePaginationParams({ ...req.query, ...req.body }, "movementDate", "desc");
    const { items, total } = await assetMovementService.listMovementsByAsset(Number(req.query.assetId), params);
    sendList(res, items, buildPaginationMeta(params, total), "Movimientos de activo obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createAssetMovementSchema>;
    const movement = await assetMovementService.createAssetMovement({ ...body, createdBy: req.user?.userId });
    sendOk(res, movement, "Movimiento de activo creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

// Paso 9: picker de empleado en AssignAssets.tsx -busqueda acotada por RUT o
// nombre (ver listAssignableUsers), sin exponer el listado completo de
// usuarios.
export async function listAssignable(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : "";
    const users = await listAssignableUsers(search);
    sendOk(res, users, "Usuarios asignables obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function assign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof assignAssetSchema>;
    const movement = await assetMovementService.assignAssetToUser({ ...body, createdBy: req.user?.userId });
    sendOk(res, movement, "Activo asignado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}
