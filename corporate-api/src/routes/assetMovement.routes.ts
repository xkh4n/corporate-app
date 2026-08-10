import { Router } from "express";
import * as assetMovementController from "../controllers/assetMovement.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const assetMovementRouter = Router();

assetMovementRouter.use(authenticate);
assetMovementRouter.get("/", authorize("asset-movements", "read"), assetMovementController.list);
assetMovementRouter.post(
  "/",
  authorize("asset-movements", "create"),
  validateBody(assetMovementController.createAssetMovementSchema),
  assetMovementController.create,
);
