import { Router } from "express";
import * as settingsController from "../controllers/previredSettings.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const previredSettingsRouter = Router();

previredSettingsRouter.use(authenticate);

// Configuracion previsional de la EMPRESA (CCAF y mutual): una sola fila, no
// hay :id. Los colaboradores la heredan al generarse su linea de nomina.
previredSettingsRouter.get("/", authorize("previred-settings", "read"), settingsController.get);
previredSettingsRouter.put(
  "/",
  authorize("previred-settings", "update"),
  validateBody(settingsController.saveSettingsSchema),
  settingsController.save,
);
