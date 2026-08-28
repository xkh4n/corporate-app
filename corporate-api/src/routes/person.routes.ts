import { Router } from "express";
import * as personController from "../controllers/person.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const personRouter = Router();

// PII: a diferencia de roles (lectura abierta a cualquier autenticado),
// personas queda restringido por permiso de punta a punta (solo "admin" lo
// tiene por defecto, ver permission-catalog.ts).
personRouter.use(authenticate);

// GET /persons - Lista paginada completa (admite "search" generico, LIKE
// contra firstName/lastName/documentId/email/phone). Busquedas puntuales:
// ver POST /bydocumentId y POST /byname mas abajo.
personRouter.get("/", authorize("persons", "read"), personController.list);
personRouter.get("/:id", authorize("persons", "read"), personController.getById);

// POST /persons/bydocumentId - {documentId} en el body, match EXACTO.
personRouter.post(
  "/bydocumentId",
  authorize("persons", "read"),
  validateBody(personController.findByDocumentIdSchema),
  personController.findByDocumentId,
);

// POST /persons/byname - {name} en el body, LIKE contra firstName/lastName.
personRouter.post(
  "/byname",
  authorize("persons", "read"),
  validateBody(personController.findByNameSchema),
  personController.findByName,
);
personRouter.post(
  "/",
  authorize("persons", "create"),
  validateBody(personController.createPersonSchema),
  personController.create,
);
personRouter.put(
  "/:id",
  authorize("persons", "update"),
  validateBody(personController.updatePersonSchema),
  personController.update,
);
personRouter.delete("/:id", authorize("persons", "delete"), personController.deactivate);
