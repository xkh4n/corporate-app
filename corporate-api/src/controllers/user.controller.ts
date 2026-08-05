import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as userService from "../services/mssql/user.service";
import * as roleService from "../services/postgres/role.service";
import * as permissionService from "../services/postgres/permission.service";
import { revokeAllRefreshTokens, invalidateUserSessions } from "../services/redis/session.service";
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

// GET /users/:id/access - vista combinada para pantallas de administracion:
// el usuario (sin passwordHash), su rol (Postgres, sin FK real hacia
// users.roleId -se resuelve a mano, mismo criterio cross-engine de siempre)
// y los permisos que ese rol tiene asignados (RolePermissionModel).
export async function getAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const user = await userService.getUserByIdOrThrow(id);
    const { passwordHash, ...safeUser } = user.get({ plain: true });
    const [role, permissions] = await Promise.all([
      roleService.getRoleByIdOrThrow(safeUser.roleId),
      permissionService.getPermissionsForRole(safeUser.roleId),
    ]);
    sendOk(res, { user: safeUser, role, permissions }, "Acceso del usuario obtenido exitosamente");
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
    const id = Number(req.params.id);
    const user = await userService.updateUser(id, body);

    // Si cambia el rol: revoca los refresh tokens (para que no pueda
    // renovar con el rol viejo, ver auth.controller.ts refresh()) Y marca el
    // watermark de invalidacion (para que el access token que YA tiene en
    // la mano, todavia valido, se rechace de inmediato en authenticate.ts
    // en vez de esperar a que expire solo, hasta 12h).
    if (body.roleId !== undefined) {
      await revokeAllRefreshTokens(id);
      await invalidateUserSessions(id, "role_changed");
    }

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
    // Un cambio de password invalida todas las sesiones activas: refresh
    // tokens (no puede renovar) y el access token/sesion ya emitido
    // (watermark, rechazado de inmediato en authenticate.ts).
    await revokeAllRefreshTokens(id);
    await invalidateUserSessions(id, "password_changed");
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
    // Motivo "deactivated": authenticate.ts lo trata distinto a
    // role_changed/password_changed -devuelve el 401 generico de siempre,
    // sin el detalle "reason" (ver INVALIDATION_MESSAGES ahi), a proposito
    // para no exponerle a un usuario deshabilitado por que fallo su sesion.
    await invalidateUserSessions(id, "deactivated");
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
