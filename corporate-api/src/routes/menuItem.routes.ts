import { Router } from "express";
import * as menuItemController from "../controllers/menuItem.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize, authorizeAny } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const menuItemRouter = Router();

menuItemRouter.use(authenticate);

// GET /menu-items - Catalogo plano (paginado). Requiere "menu-items:read"
// -sin grantToUser, admin-only: a diferencia del catalogo de permisos (solo
// strings resource+action), esto expone labels/estructura real de
// funcionalidades del sistema. El arbol PODADO por permisos del usuario
// logueado es GET /auth/menu (auth.routes.ts), no este. Acepta tambien
// "menu-items:create": "Nueva Pantalla" necesita listar las carpetas padre y
// las rutas en uso, y quien puede crear items ya decide sobre esa misma
// estructura (mismo criterio que asset-imports, donde create alcanza para
// consultar).
menuItemRouter.get("/", authorizeAny("menu-items", ["read", "create"]), menuItemController.list);
menuItemRouter.get("/:id", authorizeAny("menu-items", ["read", "create"]), menuItemController.getById);

menuItemRouter.post(
  "/",
  authorize("menu-items", "create"),
  validateBody(menuItemController.createMenuItemSchema),
  menuItemController.create,
);

menuItemRouter.put(
  "/:id",
  authorize("menu-items", "update"),
  validateBody(menuItemController.updateMenuItemSchema),
  menuItemController.update,
);

// DELETE /menu-items/:id - Desactiva (is_active=false). Rechaza con 409 si
// el nodo todavia tiene hijos activos (ver deactivateMenuItem en
// menuItem.service.ts) -evita dejar un subarbol huerfano en silencio.
menuItemRouter.delete("/:id", authorize("menu-items", "delete"), menuItemController.deactivate);
