import { Router } from "express";
import * as positionController from "../controllers/position.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const positionRouter = Router();

positionRouter.use(authenticate);

// Reutiliza el recurso "employees": un cargo es metadata de colaboradores
// (a que rol del sistema se asocia, ver menu-catalog.ts "Nuevo Cargo" ->
// employees:create), no un recurso de seguridad aparte -mismo criterio que
// no crear un "employees-photos" solo porque vive en otra tabla.
positionRouter.get("/", authorize("employees", "read"), positionController.list);
positionRouter.get("/:id", authorize("employees", "read"), positionController.getById);
positionRouter.post(
  "/",
  authorize("employees", "create"),
  validateBody(positionController.createPositionSchema),
  positionController.create,
);
positionRouter.put(
  "/:id",
  authorize("employees", "update"),
  validateBody(positionController.updatePositionSchema),
  positionController.update,
);
