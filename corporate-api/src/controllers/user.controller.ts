import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as userService from "../services/mssql/user.service";
import { revokeAllRefreshTokens } from "../services/redis/session.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk, sendNoContent } from "../library/response";

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

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await userService.listUsers(params);
    sendList(res, items, buildPaginationMeta(params, total), "Usuarios obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await userService.getUserByIdOrThrow(Number(req.params.id));
    const { passwordHash, ...safe } = user.get({ plain: true });
    sendOk(res, safe, "Usuario obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createUserSchema>;
    const user = await userService.createUser(body);
    sendOk(res, user, "Usuario creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateUserSchema>;
    const user = await userService.updateUser(Number(req.params.id), body);
    sendOk(res, user, "Usuario actualizado exitosamente");
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
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    await userService.deactivateUser(id);
    await revokeAllRefreshTokens(id);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
