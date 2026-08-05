import { Router } from "express";
import * as assetController from "../controllers/asset.controller";
import { authenticate } from "../middlewares/authenticate";
import { validateBody } from "../middlewares/validate";

export const assetRouter = Router();

assetRouter.use(authenticate);
assetRouter.get("/", assetController.list);
assetRouter.get("/:id", assetController.getById);
assetRouter.put("/:id", validateBody(assetController.updateAssetSchema), assetController.update);
