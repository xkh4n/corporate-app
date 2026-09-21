import { Router } from "express";
import * as assetValuationController from "../controllers/assetValuation.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const assetValuationRouter = Router();

assetValuationRouter.use(authenticate);

// Adquisiciones TI: asignar valor por primera vez a los activos que no lo tienen.
assetValuationRouter.get("/", authorize("asset-valuation", "read"), assetValuationController.list);
assetValuationRouter.post(
  "/",
  authorize("asset-valuation", "update"),
  validateBody(assetValuationController.valueAssetsSchema),
  assetValuationController.valueBatch,
);
