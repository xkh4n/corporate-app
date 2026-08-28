import { Router } from "express";
import * as assetController from "../controllers/asset.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const assetRouter = Router();

assetRouter.use(authenticate);
// Declaradas ANTES de "/:id" -mismo criterio defensivo que
// assetMovement.routes.ts: "/labels.zpl" no es un ":id".
assetRouter.post(
  "/labels.zpl",
  authorize("assets", "read"),
  validateBody(assetController.printAssetLabelsSchema),
  assetController.downloadLabelsBatch,
);
assetRouter.get("/", authorize("assets", "read"), assetController.list);
assetRouter.get("/:id", authorize("assets", "read"), assetController.getById);
assetRouter.get("/:id/label.zpl", authorize("assets", "read"), assetController.downloadLabel);
assetRouter.put(
  "/:id",
  authorize("assets", "update"),
  validateBody(assetController.updateAssetSchema),
  assetController.update,
);
