import { Router } from "express";
import * as purchaseOrderController from "../controllers/purchaseOrder.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { uploadSingle } from "../middlewares/upload";
import { validateBody } from "../middlewares/validate";

export const purchaseOrderRouter = Router();

purchaseOrderRouter.use(authenticate);
purchaseOrderRouter.get("/", authorize("purchase-orders", "read"), purchaseOrderController.list);
// Declaradas ANTES de "/:id" para que Express no matchee "documents"/
// "attachment"/"send-to-supplier" como si fueran :id -mismo criterio que
// purchaseRequest.routes.ts.
purchaseOrderRouter.get(
  "/:id/documents",
  authorize("purchase-orders", "read"),
  purchaseOrderController.listDocuments,
);
purchaseOrderRouter.get(
  "/:id/documents/:filename",
  authorize("purchase-orders", "read"),
  purchaseOrderController.downloadDocumentFile,
);
purchaseOrderRouter.get(
  "/:id",
  authorize("purchase-orders", "read"),
  purchaseOrderController.getById,
);
purchaseOrderRouter.post(
  "/",
  authorize("purchase-orders", "create"),
  validateBody(purchaseOrderController.createPurchaseOrderSchema),
  purchaseOrderController.create,
);
// Adjuntar el PDF de la OC (el solicitante, permiso purchase-orders:update)
// y enviarla al proveedor (el analista, quotes:create) son dos permisos
// DISTINTOS a proposito -adjuntar no debe implicar poder enviar al
// proveedor.
purchaseOrderRouter.post(
  "/:id/attachment",
  authorize("purchase-orders", "update"),
  uploadSingle("file"),
  purchaseOrderController.uploadAttachment,
);
purchaseOrderRouter.post(
  "/:id/send-to-supplier",
  authorize("quotes", "create"),
  purchaseOrderController.sendToSupplier,
);
