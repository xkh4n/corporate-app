import { Router } from "express";
import * as controller from "../controllers/assetAccounting.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

// Gestion contable de activos (plan 007). Todos los permisos son admin-only
// por defecto (sin grantToUser): se habilitan por rol con los permisos de
// pantalla de Contabilidad > Gestion de Activos.

// /asset-accounting: clasificacion, costo, capitalizacion y parametros.
export const assetAccountingRouter = Router();
assetAccountingRouter.use(authenticate);

assetAccountingRouter.get("/pending", authorize("asset-accounting", "read"), controller.listPending);
assetAccountingRouter.get("/", authorize("asset-accounting", "read"), controller.listRecords);
assetAccountingRouter.get("/:assetId", authorize("asset-accounting", "read"), controller.getRecord);
assetAccountingRouter.post(
  "/:assetId/classification",
  authorize("asset-accounting", "update"),
  validateBody(controller.classifySchema),
  controller.classify,
);
assetAccountingRouter.get("/:assetId/costs", authorize("asset-accounting", "read"), controller.listCosts);
assetAccountingRouter.post(
  "/:assetId/costs",
  authorize("asset-accounting", "update"),
  validateBody(controller.addCostSchema),
  controller.addCost,
);
assetAccountingRouter.delete("/:assetId/costs/:costId", authorize("asset-accounting", "update"), controller.removeCost);
assetAccountingRouter.post("/:assetId/cost/confirm", authorize("asset-accounting", "update"), controller.confirmCost);
// Capitalizar escribe en el Kardex: permiso propio, separado de "update".
assetAccountingRouter.post(
  "/:assetId/capitalize",
  authorize("asset-capitalization", "create"),
  validateBody(controller.capitalizeSchema),
  controller.capitalize,
);
assetAccountingRouter.put(
  "/:assetId/depreciation",
  authorize("asset-accounting", "update"),
  validateBody(controller.depreciationParamsSchema),
  controller.updateDepreciation,
);
assetAccountingRouter.get(
  "/:assetId/depreciation/schedule",
  authorize("asset-accounting", "read"),
  controller.getSchedule,
);

// /asset-depreciation-runs: cierre mensual. Cerrar y anular escriben en el
// Kardex de todos los activos depreciables: permisos separados de la lectura.
export const assetDepreciationRunRouter = Router();
assetDepreciationRunRouter.use(authenticate);

assetDepreciationRunRouter.get("/", authorize("asset-depreciation", "read"), controller.listRuns);
assetDepreciationRunRouter.get("/next", authorize("asset-depreciation", "read"), controller.previewNextClose);
assetDepreciationRunRouter.get("/:id", authorize("asset-depreciation", "read"), controller.getRun);
assetDepreciationRunRouter.post(
  "/",
  authorize("asset-depreciation", "create"),
  validateBody(controller.closePeriodSchema),
  controller.closePeriod,
);
assetDepreciationRunRouter.post("/:id/void", authorize("asset-depreciation", "delete"), controller.voidRun);

// /asset-accounting-policy: umbral de capitalizacion y clases contables.
export const assetAccountingPolicyRouter = Router();
assetAccountingPolicyRouter.use(authenticate);

assetAccountingPolicyRouter.get("/", authorize("asset-accounting-policy", "read"), controller.getPolicy);
assetAccountingPolicyRouter.put(
  "/",
  authorize("asset-accounting-policy", "update"),
  validateBody(controller.policySchema),
  controller.updatePolicy,
);
assetAccountingPolicyRouter.get("/classes", authorize("asset-accounting-policy", "read"), controller.listClasses);
assetAccountingPolicyRouter.post(
  "/classes",
  authorize("asset-accounting-policy", "update"),
  validateBody(controller.createClassSchema),
  controller.createClass,
);
assetAccountingPolicyRouter.put(
  "/classes/:id",
  authorize("asset-accounting-policy", "update"),
  validateBody(controller.updateClassSchema),
  controller.updateClass,
);
