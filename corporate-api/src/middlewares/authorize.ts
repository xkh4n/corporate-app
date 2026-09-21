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
  return authorizeAny(resource, [action]);
}

// Igual que authorize pero basta con UNO de los permisos (p. ej. quien puede crear cargas tambien puede consultar sus
// propias cargas aunque no tenga el permiso de lectura). El mensaje 403 lista los permisos aceptados.
export function authorizeAny(resource: string, actions: PermissionAction[]) {
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
      for (const action of actions) {
        if (await hasPermission(req.user.roleId, resource, action)) {
          next();
          return;
        }
      }
      next(new ForbiddenError(`Requiere permiso ${actions.map((action) => `'${resource}:${action}'`).join(" o ")}`));
    } catch (err) {
      next(err);
    }
  };
}
