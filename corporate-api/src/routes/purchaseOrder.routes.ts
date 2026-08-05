import { Router } from "express";
import * as purchaseOrderController from "../controllers/purchaseOrder.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const purchaseOrderRouter = Router();

purchaseOrderRouter.use(authenticate);
purchaseOrderRouter.get("/", purchaseOrderController.list);
purchaseOrderRouter.get("/:id", purchaseOrderController.getById);
purchaseOrderRouter.post(
  "/",
  authorize("purchase-orders", "create"),
  validateBody(purchaseOrderController.createPurchaseOrderSchema),
  purchaseOrderController.create,
);
