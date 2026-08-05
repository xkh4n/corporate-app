import { Router } from "express";
import * as employeeController from "../controllers/employee.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const employeeRouter = Router();

employeeRouter.use(authenticate);
// GET /employees - Lista paginada completa (admite "search" generico, LIKE
// contra employeeCode). Busquedas puntuales por la persona asociada: ver
// POST /bydocumentId y POST /byname mas abajo.
employeeRouter.get("/", employeeController.list);
employeeRouter.get("/:id", employeeController.getById);

// POST /employees/bydocumentId - {documentId} en el body, match EXACTO
// contra la persona asociada.
employeeRouter.post(
  "/bydocumentId",
  validateBody(employeeController.findByDocumentIdSchema),
  employeeController.findByDocumentId,
);

// POST /employees/byname - {name} en el body, LIKE contra
// firstName/lastName de la persona asociada.
employeeRouter.post(
  "/byname",
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
