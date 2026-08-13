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
// Declaradas ANTES de "/:id" para que Express no las matchee como
// req.params.id = "approvers"/"my-approvals".
purchaseRequestRouter.get(
  "/approvers",
  authorize("purchase-requests", "create"),
  purchaseRequestController.listApprovers,
);
purchaseRequestRouter.get(
  "/my-approvals",
  authorize("purchase-requests", "approve"),
  purchaseRequestController.listMyApprovals,
);
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
// Mismo permiso que crear una cotizacion (quotes:create): quien puede
// solicitarle una cotizacion a un proveedor tambien puede pedirle que se le
// mande por correo el mismo documento -no se agrega una accion nueva al
// catalogo para esto.
purchaseRequestRouter.post(
  "/:id/send-quote-email",
  authorize("quotes", "create"),
  validateBody(purchaseRequestController.sendQuoteEmailSchema),
  purchaseRequestController.sendQuoteEmail,
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
