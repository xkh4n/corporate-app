import { Router } from "express";
import * as parameterController from "../controllers/payrollParameter.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const payrollParameterRouter = Router();

payrollParameterRouter.use(authenticate);

payrollParameterRouter.get("/", authorize("payroll-parameters", "read"), parameterController.list);
payrollParameterRouter.put(
  "/",
  authorize("payroll-parameters", "update"),
  validateBody(parameterController.setParameterSchema),
  parameterController.set,
);
