import type { NextFunction, Request, Response } from "express";
import { env } from "../library/env";
import { ForbiddenError, UnauthorizedError } from "../library/errors";

// authorize() sin argumentos = solo exige estar autenticado.
// authorize("admin", "supervisor") = ademas exige uno de esos roles.
export function authorize(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (env.flags.disablePermissions) {
      next();
      return;
    }

    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.roleName)) {
      next(new ForbiddenError(`Requiere rol: ${allowedRoles.join(" o ")}`));
      return;
    }

    next();
  };
}
