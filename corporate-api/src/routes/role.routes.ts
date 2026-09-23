import { Router } from "express";
import * as roleController from "../controllers/role.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const roleRouter = Router();

roleRouter.use(authenticate);

// GET /roles - Lista paginada de roles (name, description, isActive).
// Requiere "roles:read" -sin grantToUser, admin-only: expone la
// configuracion de seguridad del sistema, mismo criterio que
// create/update/delete de este mismo recurso.
roleRouter.get("/", authorize("roles", "read"), roleController.list);

// GET /roles/:id - Detalle de un rol por id.
roleRouter.get("/:id", authorize("roles", "read"), roleController.getById);

// POST /roles - Crea un rol nuevo (nace sin ningun permiso asignado, ver
// PUT /:id/permissions). Requiere "roles:create".
roleRouter.post(
  "/",
  authorize("roles", "create"),
  validateBody(roleController.createRoleSchema),
  roleController.create,
);

// PUT /roles/:id - Edita name/description del rol (no sus permisos, eso es
// PUT /:id/permissions; ni su estado, ver /:id/activate y DELETE /:id).
// Requiere "roles:update". 400 si trae isActive.
roleRouter.put(
  "/:id",
  authorize("roles", "update"),
  validateBody(roleController.updateRoleSchema),
  roleController.update,
);

// PATCH /roles/:id/activate - Reactiva un rol desactivado. Exige AMBOS
// "roles:update" y "roles:activate" (dos authorize encadenados, no
// authorizeAny): activate se otorga a usuarios puntuales ademas del update
// general. 409 si es "admin" (ver role.service.ts).
roleRouter.patch(
  "/:id/activate",
  authorize("roles", "update"),
  authorize("roles", "activate"),
  roleController.activate,
);

// DELETE /roles/:id - Desactiva el rol (isActive=false, no borra la fila).
// Requiere "roles:delete". 409 si es "admin" (ver role.service.ts).
roleRouter.delete("/:id", authorize("roles", "delete"), roleController.deactivate);

// Asignacion de permisos a un rol: las escrituras (PUT/POST/DELETE) estan
// gateadas por "permissions:update" (menu Permisos > "Modificar Permisos"),
// no por "roles:update" -editar el rol (nombre/descripcion/estado, PUT /:id)
// y decidir que puede hacer son dos capacidades distintas. Hasta 2026-09-23
// las 4 rutas de abajo exigian "roles:update" y la pantalla colgaba de
// Personas > Roles.

// GET /roles/:id/permissions - Lista los permisos actualmente asignados al
// rol. Solo lectura: "roles:read" (pantalla "Ver Rol"), mismo criterio que
// GET /roles/:id -ver que puede hacer un rol es parte de consultarlo.
roleRouter.get("/:id/permissions", authorize("roles", "read"), roleController.getPermissions);

// PUT /roles/:id/permissions - Reemplaza el set COMPLETO de permisos del rol
// (no incremental: {permissionIds: number[]} vacio deja el rol sin ningun
// permiso).
roleRouter.put(
  "/:id/permissions",
  authorize("permissions", "update"),
  validateBody(roleController.setRolePermissionsSchema),
  roleController.setPermissions,
);

// POST /roles/:id/permissions - Agrega UN permiso sin tocar los demas que el
// rol ya tenia ({permissionId: number}).
roleRouter.post(
  "/:id/permissions",
  authorize("permissions", "update"),
  validateBody(roleController.addRolePermissionSchema),
  roleController.addPermission,
);

// DELETE /roles/:id/permissions/:permissionId - Quita UN permiso sin tocar
// los demas.
roleRouter.delete(
  "/:id/permissions/:permissionId",
  authorize("permissions", "update"),
  roleController.removePermission,
);
