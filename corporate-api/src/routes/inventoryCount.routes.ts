import { Router } from "express";
import * as inventoryCountController from "../controllers/inventoryCount.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { holderLookupRateLimiter } from "../middlewares/rateLimit";
import { validateBody } from "../middlewares/validate";

export const inventoryCountRouter = Router();

inventoryCountRouter.use(authenticate);

// Rutas literales ANTES de "/:id" (mismo criterio que assetMovement.routes.ts).
inventoryCountRouter.post(
  "/holders/lookup",
  authorize("inventory-counts", "create"),
  holderLookupRateLimiter,
  validateBody(inventoryCountController.findHolderSchema),
  inventoryCountController.findHolder,
);
inventoryCountRouter.post(
  "/start",
  authorize("inventory-counts", "create"),
  validateBody(inventoryCountController.startInventoryCountSchema),
  inventoryCountController.start,
);

inventoryCountRouter.get("/", authorize("inventory-counts", "read"), inventoryCountController.list);
inventoryCountRouter.get("/:id", authorize("inventory-counts", "read"), inventoryCountController.getById);

// Captura: escanear/ingresar equipos mientras la toma esta OPEN.
inventoryCountRouter.get("/:id/lookup", authorize("inventory-counts", "create"), inventoryCountController.lookup);
inventoryCountRouter.get("/:id/lines", authorize("inventory-counts", "read"), inventoryCountController.listLines);
inventoryCountRouter.post(
  "/:id/lines",
  authorize("inventory-counts", "create"),
  validateBody(inventoryCountController.addInventoryLineSchema),
  inventoryCountController.addLine,
);
inventoryCountRouter.put(
  "/:id/lines/:lineId",
  authorize("inventory-counts", "update"),
  validateBody(inventoryCountController.updateInventoryLineSchema),
  inventoryCountController.updateLine,
);
inventoryCountRouter.delete(
  "/:id/lines/:lineId",
  authorize("inventory-counts", "update"),
  inventoryCountController.deleteLine,
);

// "Fin Inventario" y reporte.
inventoryCountRouter.post("/:id/close", authorize("inventory-counts", "update"), inventoryCountController.close);
inventoryCountRouter.get("/:id/report", authorize("inventory-counts", "read"), inventoryCountController.report);
inventoryCountRouter.get(
  "/:id/report.pdf",
  authorize("inventory-counts", "read"),
  inventoryCountController.downloadReportPdf,
);
inventoryCountRouter.get("/:id/labels.zpl", authorize("inventory-counts", "read"), inventoryCountController.downloadLabels);
