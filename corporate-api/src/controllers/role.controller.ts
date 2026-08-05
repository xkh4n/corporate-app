import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as roleService from "../services/postgres/role.service";
import * as permissionService from "../services/postgres/permission.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk, sendNoContent } from "../library/response";

export const createRoleSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(255).optional(),
  isActive: z.boolean().optional(),
});

export const updateRoleSchema = createRoleSchema.partial();

export const setRolePermissionsSchema = z.object({
  permissionIds: z.array(z.number().int().positive()),
});

export const addRolePermissionSchema = z.object({
  permissionId: z.number().int().positive(),
});

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

export async function getPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const permissions = await permissionService.getPermissionsForRole(Number(req.params.id));
    sendOk(res, permissions, "Permisos del rol obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

// Reemplaza el set completo de permisos del rol (no incremental, ver
// permission.service.ts). approverId/createdBy no aplica aca: quien hizo el
// cambio no se registra a nivel de fila individual, solo importa el estado
// final.
export async function setPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { permissionIds } = req.body as z.infer<typeof setRolePermissionsSchema>;
    const permissions = await permissionService.setRolePermissions(Number(req.params.id), permissionIds);
    sendOk(res, permissions, "Permisos del rol actualizados exitosamente");
  } catch (err) {
    next(err);
  }
}

// Agrega un permiso sin perder los que el rol ya tenia (a diferencia de
// setPermissions, que reemplaza todo el set).
export async function addPermission(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { permissionId } = req.body as z.infer<typeof addRolePermissionSchema>;
    const permissions = await permissionService.addRolePermission(Number(req.params.id), permissionId);
    sendOk(res, permissions, "Permiso agregado al rol exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

// Quita un solo permiso sin perder los demas.
export async function removePermission(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await permissionService.removeRolePermission(Number(req.params.id), Number(req.params.permissionId));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
