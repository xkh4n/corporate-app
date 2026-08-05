import { Router } from "express";
import * as costCenterController from "../controllers/costCenter.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const costCenterRouter = Router();

costCenterRouter.use(authenticate);
costCenterRouter.get("/", costCenterController.list);
costCenterRouter.get("/:id", costCenterController.getById);
costCenterRouter.post(
  "/",
  authorize("admin"),
  validateBody(costCenterController.createCostCenterSchema),
  costCenterController.create,
);
costCenterRouter.put(
  "/:id",
  authorize("admin"),
  validateBody(costCenterController.updateCostCenterSchema),
  costCenterController.update,
);
