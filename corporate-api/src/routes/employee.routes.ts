import { Router } from "express";
import * as employeeController from "../controllers/employee.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const employeeRouter = Router();

employeeRouter.use(authenticate);

// PII (via la persona asociada: documentId, email, phone, birthDate) -mismo
// criterio que person.routes.ts: restringido por permiso, no abierto a
// cualquier autenticado (hallazgo de auditoria: antes de este fix, estas 4
// rutas eran las UNICAS de todo el modulo de terceros/colaboradores sin
// gate, permitiendo pivotar desde /employees para leer PII bloqueada en
// /persons).
// GET /employees - Lista paginada completa (admite "search" generico, LIKE
// contra employeeCode). Busquedas puntuales por la persona asociada: ver
// POST /bydocumentId y POST /byname mas abajo.
employeeRouter.get("/", authorize("employees", "read"), employeeController.list);
employeeRouter.get("/:id", authorize("employees", "read"), employeeController.getById);

// POST /employees/bydocumentId - {documentId} en el body, match EXACTO
// contra la persona asociada.
employeeRouter.post(
  "/bydocumentId",
  authorize("employees", "read"),
  validateBody(employeeController.findByDocumentIdSchema),
  employeeController.findByDocumentId,
);

// POST /employees/byname - {name} en el body, LIKE contra
// firstName/lastName de la persona asociada.
employeeRouter.post(
  "/byname",
  authorize("employees", "read"),
  validateBody(employeeController.findByNameSchema),
  employeeController.findByName,
);
employeeRouter.post(
  "/",
  authorize("employees", "create"),
  validateBody(employeeController.createEmployeeSchema),
  employeeController.create,
);
employeeRouter.put(
  "/:id",
  authorize("employees", "update"),
  validateBody(employeeController.updateEmployeeSchema),
  employeeController.update,
);
