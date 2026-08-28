import { Router } from "express";
import * as permissionController from "../controllers/permission.controller";
import { authenticate } from "../middlewares/authenticate";

export const permissionRouter = Router();

permissionRouter.use(authenticate);

// GET /permissions - Catalogo completo de permisos (resource+action+
// description), paginado y con busqueda. Se siembra desde
// databases/permission-catalog.ts, no se crea via API. Lectura abierta a
// cualquier autenticado (es solo metadata, util para armar el formulario
// de "editar permisos del rol" en el frontend).
permissionRouter.get("/", permissionController.list);
