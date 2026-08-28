import { Router } from "express";
import * as assetMovementController from "../controllers/assetMovement.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const assetMovementRouter = Router();

assetMovementRouter.use(authenticate);
// Declaradas ANTES de "/" (no hay "/:id" en este router, pero mismo criterio
// defensivo que purchase-requests/my-requests) -paso 9: picker de empleado +
// accion de asignar una unidad puntual.
assetMovementRouter.get(
  "/assignable-users",
  authorize("asset-movements", "create"),
  assetMovementController.listAssignable,
);
assetMovementRouter.post(
  "/assign",
  authorize("asset-movements", "create"),
  validateBody(assetMovementController.assignAssetSchema),
  assetMovementController.assign,
);
assetMovementRouter.get(
  "/:id/handover.pdf",
  authorize("asset-movements", "read"),
  assetMovementController.downloadHandover,
);
assetMovementRouter.get("/", authorize("asset-movements", "read"), assetMovementController.list);
assetMovementRouter.post(
  "/",
  authorize("asset-movements", "create"),
  validateBody(assetMovementController.createAssetMovementSchema),
  assetMovementController.create,
);
