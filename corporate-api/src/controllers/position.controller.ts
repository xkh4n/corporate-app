import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as positionService from "../services/mongo/position.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createPositionSchema = z.object({
  title: z.string().min(1).max(150),
  description: z.string().min(1).max(2000),
  responsibilities: z.array(z.string().min(1).max(500)).min(1),
  technicalSkills: z.array(z.string().min(1).max(500)).optional(),
  softSkills: z.array(z.string().min(1).max(500)).optional(),
  reportsTo: z.string().max(255).optional(),
  supervises: z.string().max(255).optional(),
  roleId: z.number().int().positive(),
});

export const updatePositionSchema = createPositionSchema.partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "title");
    const { items, total } = await positionService.listPositions(params);
    sendList(res, items, buildPaginationMeta(params, total), "Cargos obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const position = await positionService.getPositionByIdOrThrow(req.params.id as string);
    sendOk(res, position, "Cargo obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createPositionSchema>;
    const position = await positionService.createPosition(body);
    sendOk(res, position, "Cargo creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updatePositionSchema>;
    const position = await positionService.updatePosition(req.params.id as string, body);
    sendOk(res, position, "Cargo actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}
