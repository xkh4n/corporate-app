import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as roleService from "../services/postgres/role.service";

export const createRoleSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(255).optional(),
  isActive: z.boolean().optional(),
});

export const updateRoleSchema = createRoleSchema.partial();

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await roleService.listRoles());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await roleService.getRoleByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createRoleSchema>;
    res.status(201).json(await roleService.createRole(body));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateRoleSchema>;
    res.json(await roleService.updateRole(Number(req.params.id), body));
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await roleService.deactivateRole(Number(req.params.id));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
