import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as userService from "../services/mssql/user.service";
import { revokeAllRefreshTokens } from "../services/redis/session.service";

export const createUserSchema = z.object({
  personId: z.number().int().positive(),
  roleId: z.number().int().positive(),
  username: z.string().min(3).max(50),
  password: z.string().min(1),
});

export const updateUserSchema = z.object({
  roleId: z.number().int().positive().optional(),
  username: z.string().min(3).max(50).optional(),
  isActive: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  password: z.string().min(1),
});

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await userService.listUsers());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await userService.getUserByIdOrThrow(Number(req.params.id));
    const { passwordHash, ...safe } = user.get({ plain: true });
    res.json(safe);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createUserSchema>;
    res.status(201).json(await userService.createUser(body));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateUserSchema>;
    res.json(await userService.updateUser(Number(req.params.id), body));
  } catch (err) {
    next(err);
  }
}

export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { password } = req.body as z.infer<typeof changePasswordSchema>;
    const id = Number(req.params.id);
    await userService.changePassword(id, password);
    // Un cambio de password invalida todas las sesiones stateless activas
    // (mismo criterio que cualquier sistema de auth serio).
    await revokeAllRefreshTokens(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    await userService.deactivateUser(id);
    await revokeAllRefreshTokens(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
