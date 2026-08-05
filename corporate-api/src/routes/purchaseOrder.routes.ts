import { Router } from "express";
import * as purchaseOrderController from "../controllers/purchaseOrder.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { validateBody } from "../library/middlewares/validate";

export const purchaseOrderRouter = Router();

purchaseOrderRouter.use(authenticate);
purchaseOrderRouter.get("/", purchaseOrderController.list);
purchaseOrderRouter.get("/:id", purchaseOrderController.getById);
purchaseOrderRouter.post(
  "/",
  validateBody(purchaseOrderController.createPurchaseOrderSchema),
  purchaseOrderController.create,
);
