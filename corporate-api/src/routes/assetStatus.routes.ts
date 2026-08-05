import { Router } from "express";
import * as assetStatusController from "../controllers/assetStatus.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { authorize } from "../library/middlewares/authorize";
import { validateBody } from "../library/middlewares/validate";

export const assetStatusRouter = Router();

assetStatusRouter.use(authenticate);
assetStatusRouter.get("/", assetStatusController.list);
assetStatusRouter.get("/:id", assetStatusController.getById);
assetStatusRouter.post(
  "/",
  authorize("admin"),
  validateBody(assetStatusController.createAssetStatusSchema),
  assetStatusController.create,
);
assetStatusRouter.put(
  "/:id",
  authorize("admin"),
  validateBody(assetStatusController.updateAssetStatusSchema),
  assetStatusController.update,
);
