import { Router } from "express";
import * as employeeController from "../controllers/employee.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { authorize } from "../library/middlewares/authorize";
import { validateBody } from "../library/middlewares/validate";

export const employeeRouter = Router();

employeeRouter.use(authenticate);
employeeRouter.get("/", employeeController.list);
employeeRouter.get("/:id", employeeController.getById);
employeeRouter.post(
  "/",
  authorize("admin"),
  validateBody(employeeController.createEmployeeSchema),
  employeeController.create,
);
employeeRouter.put(
  "/:id",
  authorize("admin"),
  validateBody(employeeController.updateEmployeeSchema),
  employeeController.update,
);
