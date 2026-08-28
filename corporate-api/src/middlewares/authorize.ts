import type { NextFunction, Request, Response } from "express";
import { env } from "../library/env";
import { hasPermission } from "../services/postgres/permission.service";
import type { PermissionAction } from "../models/postgres/permission.model";
import { ForbiddenError, UnauthorizedError } from "../library/errors";

// authorize(resource, action) exige que el rol del usuario autenticado tenga
// ese permiso asignado (tabla role_permissions, ver
// databases/permission-catalog.ts). "admin" tiene bypass total hardcodeado
// -superusuario real, no depende de filas en la tabla- para que nunca pueda
// quedar bloqueado por un seed incompleto o un permiso mal desasignado.
export function authorize(resource: string, action: PermissionAction) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (env.flags.disablePermissions) {
      next();
      return;
    }

    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }

    if (req.user.roleName === "admin") {
      next();
      return;
    }

    try {
      const allowed = await hasPermission(req.user.roleId, resource, action);
      if (!allowed) {
        next(new ForbiddenError(`Requiere permiso '${resource}:${action}'`));
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
