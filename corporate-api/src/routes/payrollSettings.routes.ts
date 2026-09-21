import { Router } from "express";
import * as settingsController from "../controllers/payrollSettings.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const payrollSettingsRouter = Router();

payrollSettingsRouter.use(authenticate);

// Configuracion de remuneraciones de la EMPRESA: una sola fila, sin :id.
payrollSettingsRouter.get("/", authorize("payroll-settings", "read"), settingsController.get);
payrollSettingsRouter.put(
  "/",
  authorize("payroll-settings", "update"),
  validateBody(settingsController.savePayrollSettingsSchema),
  settingsController.save,
);
