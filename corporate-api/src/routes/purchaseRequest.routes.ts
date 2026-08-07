import { Router } from "express";
import * as purchaseRequestController from "../controllers/purchaseRequest.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const purchaseRequestRouter = Router();

// Permiso "purchase-requests:X" por accion -por defecto "admin" y "user" lo
// tienen (preserva el acceso que ya existia), pero un rol nuevo (ej.
// "contabilidad") nace sin el. "approve" (PATCH .../status) queda separado
// de "update" (PUT /:id) a proposito: aprobar el estado es mas sensible que
// editar datos, y solo "admin" lo tiene por defecto -ver
// permission-catalog.ts.
purchaseRequestRouter.use(authenticate);
purchaseRequestRouter.get("/", authorize("purchase-requests", "read"), purchaseRequestController.list);
purchaseRequestRouter.get(
  "/:id",
  authorize("purchase-requests", "read"),
  purchaseRequestController.getById,
);
purchaseRequestRouter.get(
  "/:id/quote-document",
  authorize("purchase-requests", "read"),
  purchaseRequestController.downloadQuoteDocument,
);
purchaseRequestRouter.get(
  "/:id/quote-documents",
  authorize("purchase-requests", "read"),
  purchaseRequestController.listQuoteDocuments,
);
purchaseRequestRouter.get(
  "/:id/quote-documents/:filename",
  authorize("purchase-requests", "read"),
  purchaseRequestController.downloadQuoteDocumentFile,
);
purchaseRequestRouter.post(
  "/",
  authorize("purchase-requests", "create"),
  validateBody(purchaseRequestController.createPurchaseRequestSchema),
  purchaseRequestController.create,
);
purchaseRequestRouter.put(
  "/:id",
  authorize("purchase-requests", "update"),
  validateBody(purchaseRequestController.updatePurchaseRequestSchema),
  purchaseRequestController.update,
);
purchaseRequestRouter.patch(
  "/:id/status",
  authorize("purchase-requests", "approve"),
  validateBody(purchaseRequestController.updateStatusSchema),
  purchaseRequestController.updateStatus,
);
