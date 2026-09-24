import { Router } from "express";
import * as controller from "../controllers/assetWriteOff.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { uploadSingle } from "../middlewares/upload";
import { validateBody } from "../middlewares/validate";

// Certificado notarial y fotos: 5 MB por archivo acotan la memoria de cada subida.
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// Baja contable de activos (plan 008). Permisos admin-only por defecto (sin
// grantToUser): read = consultar; create = armar el borrador y sus archivos;
// approve = confirmar la baja, que es definitiva. Rutas literales ANTES de "/:id".
export const assetWriteOffRouter = Router();
assetWriteOffRouter.use(authenticate);

assetWriteOffRouter.get("/eligible", authorize("asset-write-offs", "create"), controller.listEligible);

assetWriteOffRouter.get("/", authorize("asset-write-offs", "read"), controller.list);
assetWriteOffRouter.post(
  "/",
  authorize("asset-write-offs", "create"),
  validateBody(controller.createWriteOffSchema),
  controller.create,
);
assetWriteOffRouter.get("/:id", authorize("asset-write-offs", "read"), controller.getById);
assetWriteOffRouter.put(
  "/:id",
  authorize("asset-write-offs", "create"),
  validateBody(controller.updateWriteOffSchema),
  controller.update,
);
assetWriteOffRouter.delete("/:id", authorize("asset-write-offs", "create"), controller.discard);

assetWriteOffRouter.post(
  "/:id/certificate",
  authorize("asset-write-offs", "create"),
  // Estado ANTES de recibir y sanear el archivo (qpdf es caro).
  controller.precheckCertificateUpload,
  // PDF sin contenido activo, reescrito por qpdf.
  uploadSingle("file", { sanitizePdf: true, maxFileSizeBytes: MAX_FILE_SIZE_BYTES }),
  controller.uploadCertificate,
);
assetWriteOffRouter.get("/:id/certificate", authorize("asset-write-offs", "read"), controller.downloadCertificate);

assetWriteOffRouter.post(
  "/:id/assets/:assetId/photos",
  authorize("asset-write-offs", "create"),
  controller.precheckPhotoUpload,
  uploadSingle("file", { kind: "image", maxFileSizeBytes: MAX_FILE_SIZE_BYTES }),
  controller.uploadPhoto,
);
assetWriteOffRouter.get("/:id/photos/:photoId", authorize("asset-write-offs", "read"), controller.getPhoto);
assetWriteOffRouter.delete("/:id/photos/:photoId", authorize("asset-write-offs", "create"), controller.removePhoto);

assetWriteOffRouter.post("/:id/confirm", authorize("asset-write-offs", "approve"), controller.confirm);
