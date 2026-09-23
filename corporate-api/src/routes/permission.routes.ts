import { Router } from "express";
import * as permissionController from "../controllers/permission.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const permissionRouter = Router();

permissionRouter.use(authenticate);

// GET /permissions - Catalogo completo de permisos (resource+action+
// description), paginado y con busqueda. Lectura abierta a cualquier
// autenticado (es solo metadata, util para armar el formulario de "editar
// permisos del rol" en el frontend).
permissionRouter.get("/", permissionController.list);

// POST /permissions - Alta en caliente de un permiso ({resource, action,
// description, includedPermissionIds?}), sin tener que tocar
// permission-catalog.ts ni recrear contenedores. includedPermissionIds solo
// para action "access" (permiso de pantalla, plan 006). Requiere
// "permissions:create" (admin-only por defecto). 409 si el par
// resource+action ya existe.
permissionRouter.post(
  "/",
  authorize("permissions", "create"),
  validateBody(permissionController.createPermissionSchema),
  permissionController.create,
);

// Permisos que incluye un agrupador "access" (plan 006). La lectura va
// abierta a cualquier autenticado, igual que GET /permissions (que ya trae
// includedPermissions en cada fila).
permissionRouter.get("/:id/includes", permissionController.getIncludes);

// POST /permissions/:id/includes - Agrega un permiso base ({permissionId}) a
// un agrupador. DELETE /permissions/:id/includes/:includedId lo quita.
// Requieren "permissions:update": cambiar un agrupador cambia al instante el
// acceso de TODOS los roles que lo tienen, mismo nivel que asignar permisos
// a un rol (ver role.routes.ts). 400 si :id no es "access" o si se intenta
// incluir otro "access".
permissionRouter.post(
  "/:id/includes",
  authorize("permissions", "update"),
  validateBody(permissionController.addPermissionIncludeSchema),
  permissionController.addInclude,
);

permissionRouter.delete(
  "/:id/includes/:includedId",
  authorize("permissions", "update"),
  permissionController.removeInclude,
);
