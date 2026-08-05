import { Router } from "express";
import * as roleController from "../controllers/role.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const roleRouter = Router();

roleRouter.use(authenticate);

// GET /roles - Lista paginada de roles (name, description, isActive). Lectura
// abierta a cualquier autenticado, sin permiso puntual.
roleRouter.get("/", roleController.list);

// GET /roles/:id - Detalle de un rol por id.
roleRouter.get("/:id", roleController.getById);

// POST /roles - Crea un rol nuevo (nace sin ningun permiso asignado, ver
// PUT /:id/permissions). Requiere "roles:create".
roleRouter.post(
  "/",
  authorize("roles", "create"),
  validateBody(roleController.createRoleSchema),
  roleController.create,
);

// PUT /roles/:id - Edita name/description/isActive del rol (no sus
// permisos, eso es PUT /:id/permissions). Requiere "roles:update".
roleRouter.put(
  "/:id",
  authorize("roles", "update"),
  validateBody(roleController.updateRoleSchema),
  roleController.update,
);

// DELETE /roles/:id - Desactiva el rol (isActive=false, no borra la fila).
// Requiere "roles:delete".
roleRouter.delete("/:id", authorize("roles", "delete"), roleController.deactivate);

// GET /roles/:id/permissions - Lista los permisos actualmente asignados al
// rol. Requiere "roles:update" (administrar permisos es una forma de editar
// el rol).
roleRouter.get("/:id/permissions", authorize("roles", "update"), roleController.getPermissions);

// PUT /roles/:id/permissions - Reemplaza el set COMPLETO de permisos del rol
// (no incremental: {permissionIds: number[]} vacio deja el rol sin ningun
// permiso). Requiere "roles:update".
roleRouter.put(
  "/:id/permissions",
  authorize("roles", "update"),
  validateBody(roleController.setRolePermissionsSchema),
  roleController.setPermissions,
);

// POST /roles/:id/permissions - Agrega UN permiso sin tocar los demas que el
// rol ya tenia ({permissionId: number}). Requiere "roles:update".
roleRouter.post(
  "/:id/permissions",
  authorize("roles", "update"),
  validateBody(roleController.addRolePermissionSchema),
  roleController.addPermission,
);

// DELETE /roles/:id/permissions/:permissionId - Quita UN permiso sin tocar
// los demas. Requiere "roles:update".
roleRouter.delete(
  "/:id/permissions/:permissionId",
  authorize("roles", "update"),
  roleController.removePermission,
);
