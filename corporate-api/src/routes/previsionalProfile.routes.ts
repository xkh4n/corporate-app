import { Router } from "express";
import * as profileController from "../controllers/previsionalProfile.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const previsionalProfileRouter = Router();

previsionalProfileRouter.use(authenticate);

// Datos previsionales y de salud de un colaborador (PII sensible: plan de
// isapre, numero de FUN). Gateados por permiso propio, no abiertos a cualquier
// autenticado -mismo criterio que /employees y /persons.
previsionalProfileRouter.get(
  "/:employeeId",
  authorize("previsional-profiles", "read"),
  profileController.getByEmployee,
);
previsionalProfileRouter.put(
  "/:employeeId/pension",
  authorize("previsional-profiles", "update"),
  validateBody(profileController.assignPensionSchema),
  profileController.assignPension,
);
previsionalProfileRouter.put(
  "/:employeeId/health",
  authorize("previsional-profiles", "update"),
  validateBody(profileController.assignHealthSchema),
  profileController.assignHealth,
);
