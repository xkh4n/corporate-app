import { Router } from "express";
import * as assetReturnController from "../controllers/assetReturn.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { uploadSingle } from "../middlewares/upload";
import { validateBody } from "../middlewares/validate";

// Una guia de despacho es un documento de pocas paginas: 5 MB sobran y acotan la memoria de cada subida.
const MAX_GUIDE_SIZE_BYTES = 5 * 1024 * 1024;

export const assetReturnRouter = Router();

assetReturnRouter.use(authenticate);

// Permisos: read = ver; create = solicitante (armar, adjuntar la guia, enviar,
// cancelar); update = recepcion en Adquisiciones. Sin grantToUser: el admin los
// asigna por rol. Rutas literales ANTES de "/:id".
assetReturnRouter.get("/candidates", authorize("asset-returns", "create"), assetReturnController.candidates);

assetReturnRouter.get("/", authorize("asset-returns", "read"), assetReturnController.list);
assetReturnRouter.post(
  "/",
  authorize("asset-returns", "create"),
  validateBody(assetReturnController.createAssetReturnSchema),
  assetReturnController.create,
);
assetReturnRouter.get("/:id", authorize("asset-returns", "read"), assetReturnController.getById);

assetReturnRouter.post(
  "/:id/lines",
  authorize("asset-returns", "create"),
  validateBody(assetReturnController.addAssetReturnLinesSchema),
  assetReturnController.addLines,
);
assetReturnRouter.delete("/:id/lines/:lineId", authorize("asset-returns", "create"), assetReturnController.removeLine);

assetReturnRouter.post(
  "/:id/document",
  authorize("asset-returns", "create"),
  // La guia se imprime y se abre en el visor: PDF sin contenido activo.
  uploadSingle("file", { sanitizePdf: true, maxFileSizeBytes: MAX_GUIDE_SIZE_BYTES }),
  assetReturnController.uploadDocument,
);
assetReturnRouter.get("/:id/document", authorize("asset-returns", "read"), assetReturnController.downloadDocument);

assetReturnRouter.post("/:id/send", authorize("asset-returns", "create"), assetReturnController.send);
assetReturnRouter.post(
  "/:id/receive",
  authorize("asset-returns", "update"),
  validateBody(assetReturnController.receiveAssetReturnSchema),
  assetReturnController.receive,
);
assetReturnRouter.post("/:id/cancel", authorize("asset-returns", "create"), assetReturnController.cancel);
