import { Router } from "express";
import * as assetMovementController from "../controllers/assetMovement.controller";
import { authenticate } from "../middlewares/authenticate";
import { validateBody } from "../middlewares/validate";

export const assetMovementRouter = Router();

assetMovementRouter.use(authenticate);
assetMovementRouter.get("/", assetMovementController.list);
assetMovementRouter.post(
  "/",
  validateBody(assetMovementController.createAssetMovementSchema),
  assetMovementController.create,
);
