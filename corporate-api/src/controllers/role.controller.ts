import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as roleService from "../services/postgres/role.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk, sendNoContent } from "../library/response";

export const createRoleSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(255).optional(),
  isActive: z.boolean().optional(),
});

export const updateRoleSchema = createRoleSchema.partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await roleService.listRoles(params);
    sendList(res, items, buildPaginationMeta(params, total), "Roles obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const role = await roleService.getRoleByIdOrThrow(Number(req.params.id));
    sendOk(res, role, "Rol obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createRoleSchema>;
    const role = await roleService.createRole(body);
    sendOk(res, role, "Rol creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateRoleSchema>;
    const role = await roleService.updateRole(Number(req.params.id), body);
    sendOk(res, role, "Rol actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await roleService.deactivateRole(Number(req.params.id));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
