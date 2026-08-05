import { Router } from "express";
import * as purchaseOrderController from "../controllers/purchaseOrder.controller";
import { authenticate } from "../middlewares/authenticate";
import { validateBody } from "../middlewares/validate";

export const purchaseOrderRouter = Router();

purchaseOrderRouter.use(authenticate);
purchaseOrderRouter.get("/", purchaseOrderController.list);
purchaseOrderRouter.get("/:id", purchaseOrderController.getById);
purchaseOrderRouter.post(
  "/",
  validateBody(purchaseOrderController.createPurchaseOrderSchema),
  purchaseOrderController.create,
);
