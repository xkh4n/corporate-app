import { Router } from "express";
import * as costCenterController from "../controllers/costCenter.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { authorize } from "../library/middlewares/authorize";
import { validateBody } from "../library/middlewares/validate";

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
