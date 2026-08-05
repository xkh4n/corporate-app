import { Router } from "express";
import * as personController from "../controllers/person.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { authorize } from "../library/middlewares/authorize";
import { validateBody } from "../library/middlewares/validate";

export const personRouter = Router();

// PII: a diferencia de roles (lectura abierta a cualquier autenticado),
// personas queda restringido a admin de punta a punta.
personRouter.use(authenticate, authorize("admin"));

personRouter.get("/", personController.list);
personRouter.get("/:id", personController.getById);
personRouter.post("/", validateBody(personController.createPersonSchema), personController.create);
personRouter.put(
  "/:id",
  validateBody(personController.updatePersonSchema),
  personController.update,
);
personRouter.delete("/:id", personController.deactivate);
