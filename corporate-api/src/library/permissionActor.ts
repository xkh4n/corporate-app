import type { Request } from "express";
import { UnauthorizedError } from "./errors";

// Quien otorga permisos o asigna roles (auditoria de seguridad run-2,
// 2026-09-24, hallazgos F1/F3): un no-admin solo puede otorgar lo que ya
// tiene. Ver assertActorCan* en services/postgres/permission.service.ts.
export interface PermissionActor {
  roleId: number;
  isAdmin: boolean;
}

export function permissionActor(req: Request): PermissionActor {
  if (!req.user) throw new UnauthorizedError();
  return { roleId: req.user.roleId, isAdmin: req.user.roleName === "admin" };
}
