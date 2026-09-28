import { Router } from "express";
import * as assetMovementController from "../controllers/assetMovement.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { uploadSingle } from "../middlewares/upload";
import { validateBody } from "../middlewares/validate";

const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

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
// Dar de baja (plan 012): permiso propio, aparte de asignar.
assetMovementRouter.get(
  "/decommission/:assetId",
  authorize("asset-decommissions", "create"),
  assetMovementController.decommissionCheck,
);
assetMovementRouter.get(
  "/decommission/:assetId/photo",
  authorize("asset-decommissions", "create"),
  assetMovementController.decommissionPhoto,
);
assetMovementRouter.post(
  "/decommission",
  authorize("asset-decommissions", "create"),
  // Plan 013: la foto del activo es obligatoria (se valida su contenido real).
  uploadSingle("photo", { kind: "image", maxFileSizeBytes: MAX_PHOTO_SIZE_BYTES }),
  validateBody(assetMovementController.decommissionAssetSchema),
  assetMovementController.decommission,
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
