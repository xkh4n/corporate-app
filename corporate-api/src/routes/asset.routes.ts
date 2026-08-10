import { Router } from "express";
import * as assetController from "../controllers/asset.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const assetRouter = Router();

assetRouter.use(authenticate);
assetRouter.get("/", authorize("assets", "read"), assetController.list);
assetRouter.get("/:id", authorize("assets", "read"), assetController.getById);
assetRouter.put(
  "/:id",
  authorize("assets", "update"),
  validateBody(assetController.updateAssetSchema),
  assetController.update,
);
