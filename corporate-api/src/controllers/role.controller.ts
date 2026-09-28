import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as roleService from "../services/postgres/role.service";
import * as permissionService from "../services/postgres/permission.service";
import { listUserIdsByRoleId } from "../services/mssql/user.service";
import { invalidateUserSessions, revokeAllRefreshTokens } from "../services/redis/session.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk, sendNoContent } from "../library/response";
import { permissionActor } from "../library/permissionActor";
import { ForbiddenError } from "../library/errors";
import { isSystemsRole } from "../library/roleCostCenter";

export const createRoleSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(255).optional(),
  isActive: z.boolean().optional(),
});

// Sin isActive: habilitar/deshabilitar tienen sus propias rutas y permisos
// (PATCH /:id/activate con roles:update+roles:activate, DELETE /:id con
// roles:delete). Si PUT lo aceptara, cualquiera con roles:update podria
// saltarse ambos. .strict() para que un isActive mandado igual sea un 400
// explicito y no se descarte en silencio.
export const updateRoleSchema = createRoleSchema.omit({ isActive: true }).partial().strict();

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
    // Revision 2026-09-28 (M1): el prefijo 1110- da el privilegio de recibir devoluciones.
    if (!permissionActor(req).isAdmin && isSystemsRole(body.name)) {
      throw new ForbiddenError("Solo un administrador crea roles de Sistemas (centro de costo 1110)");
    }
    const role = await roleService.createRole(body);
    sendOk(res, role, "Rol creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateRoleSchema>;
    const roleId = Number(req.params.id);
    const actor = permissionActor(req);
    if (!actor.isAdmin) {
      // Revision 2026-09-28 (M1): mismo criterio que sus permisos (no el propio rol ni admin), y el
      // prefijo de Sistemas (1110) solo lo pone o lo quita un administrador.
      await permissionService.assertActorCanManageRole(actor, roleId);
      if (body.name !== undefined) {
        const current = await roleService.getRoleByIdOrThrow(roleId);
        if (body.name !== current.name && (isSystemsRole(body.name) || isSystemsRole(current.name))) {
          throw new ForbiddenError("Solo un administrador renombra roles de Sistemas (centro de costo 1110)");
        }
      }
    }
    const role = await roleService.updateRole(roleId, body);
    sendOk(res, role, "Rol actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function activate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const role = await roleService.activateRole(Number(req.params.id));
    sendOk(res, role, "Rol habilitado exitosamente");
  } catch (err) {
    next(err);
  }
}

// Ademas de marcar isActive=false (hasPermission ya lo exige, ver
// permission.service.ts), invalida de inmediato la sesion/access-token de
// cada usuario que tenia este rol -sin esto, alguien con una sesion ya
// activa conservaba acceso completo hasta que su JWT expirara solo (hasta
// 12h), pese a que el rol ya estuviera "desactivado".
export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const roleId = Number(req.params.id);
    await roleService.deactivateRole(roleId);

    const userIds = await listUserIdsByRoleId(roleId);
    await Promise.all(
      userIds.map(async (userId) => {
        await revokeAllRefreshTokens(userId);
        await invalidateUserSessions(userId, "role_deactivated");
      })
    );

    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

export async function getPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const permissions = await permissionService.getAssignedPermissionsForRole(Number(req.params.id));
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
    const roleId = Number(req.params.id);
    const actor = permissionActor(req);
    await permissionService.assertActorCanManageRole(actor, roleId);
    // Solo se validan los que se AGREGAN: los que el rol ya tenia no amplian nada.
    const current = new Set((await permissionService.getAssignedPermissionsForRole(roleId)).map((p) => p.id));
    await permissionService.assertActorCanGrant(actor, permissionIds.filter((id) => !current.has(id)));
    const permissions = await permissionService.setRolePermissions(roleId, permissionIds);
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
    const actor = permissionActor(req);
    await permissionService.assertActorCanManageRole(actor, Number(req.params.id));
    await permissionService.assertActorCanGrant(actor, [permissionId]);
    const permissions = await permissionService.addRolePermission(Number(req.params.id), permissionId);
    sendOk(res, permissions, "Permiso agregado al rol exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

// Quita un solo permiso sin perder los demas.
export async function removePermission(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await permissionService.assertActorCanManageRole(permissionActor(req), Number(req.params.id));
    await permissionService.removeRolePermission(Number(req.params.id), Number(req.params.permissionId));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
