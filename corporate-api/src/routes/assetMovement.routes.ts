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
// Movimiento de Activos (plan 011).
assetMovementRouter.post(
  "/reassign",
  authorize("asset-movements", "create"),
  validateBody(assetMovementController.reassignAssetSchema),
  assetMovementController.reassign,
);
// Lista tenedores (solo nombre): exige ver activos Y movimientos.
assetMovementRouter.get(
  "/assignments",
  authorize("assets", "read"),
  authorize("asset-movements", "read"),
  assetMovementController.listAssignments,
);
assetMovementRouter.get("/current/:assetId", authorize("asset-movements", "read"), assetMovementController.current);
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
