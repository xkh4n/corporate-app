import { Router } from "express";
import * as assetStatusController from "../controllers/assetStatus.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const assetStatusRouter = Router();

assetStatusRouter.use(authenticate);
assetStatusRouter.get("/", assetStatusController.list);
assetStatusRouter.get("/:id", assetStatusController.getById);
assetStatusRouter.post(
  "/",
  authorize("asset-statuses", "create"),
  validateBody(assetStatusController.createAssetStatusSchema),
  assetStatusController.create,
);
assetStatusRouter.put(
  "/:id",
  authorize("asset-statuses", "update"),
  validateBody(assetStatusController.updateAssetStatusSchema),
  assetStatusController.update,
);
