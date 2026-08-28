import { Router } from "express";
import * as assetKardexController from "../controllers/assetKardex.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const assetKardexRouter = Router();

assetKardexRouter.use(authenticate);
// "/by-product" declarada ANTES de "/" -mismo criterio defensivo que
// assetMovement.routes.ts (assignable-users/assign antes de "/").
assetKardexRouter.get("/by-product", authorize("asset-kardex", "read"), assetKardexController.listByProduct);
assetKardexRouter.get("/", authorize("asset-kardex", "read"), assetKardexController.listByAsset);
assetKardexRouter.post(
  "/",
  authorize("asset-kardex", "create"),
  validateBody(assetKardexController.createManualEntrySchema),
  assetKardexController.create,
);
