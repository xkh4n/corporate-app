import { Router } from "express";
import * as contractController from "../controllers/employeeContract.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const employeeContractRouter = Router();

employeeContractRouter.use(authenticate);

// Sueldo y condiciones de gratificacion de cada colaborador: dato sensible,
// gateado por permiso propio (admin-only por defecto), no abierto a cualquier
// autenticado.
employeeContractRouter.get("/", authorize("employee-contracts", "read"), contractController.listByEmployee);
employeeContractRouter.post(
  "/",
  authorize("employee-contracts", "create"),
  validateBody(contractController.createContractSchema),
  contractController.create,
);
