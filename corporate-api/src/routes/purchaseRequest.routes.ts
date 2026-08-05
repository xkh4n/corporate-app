import { Router } from "express";
import * as purchaseRequestController from "../controllers/purchaseRequest.controller";
import { authenticate } from "../middlewares/authenticate";
import { validateBody } from "../middlewares/validate";

export const purchaseRequestRouter = Router();

// Flujo operativo del dia a dia: cualquier usuario autenticado puede
// solicitar/consultar, sin restringir por rol (a diferencia de los
// maestros/config, que quedan admin-only).
purchaseRequestRouter.use(authenticate);
purchaseRequestRouter.get("/", purchaseRequestController.list);
purchaseRequestRouter.get("/:id", purchaseRequestController.getById);
purchaseRequestRouter.post(
  "/",
  validateBody(purchaseRequestController.createPurchaseRequestSchema),
  purchaseRequestController.create,
);
purchaseRequestRouter.put(
  "/:id",
  validateBody(purchaseRequestController.updatePurchaseRequestSchema),
  purchaseRequestController.update,
);
purchaseRequestRouter.patch(
  "/:id/status",
  validateBody(purchaseRequestController.updateStatusSchema),
  purchaseRequestController.updateStatus,
);
