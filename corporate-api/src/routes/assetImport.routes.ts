import { Router } from "express";
import * as assetImportController from "../controllers/assetImport.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize, authorizeAny } from "../middlewares/authorize";
import { importRateLimiter, importReadRateLimiter } from "../middlewares/rateLimit";
import { uploadSingle } from "../middlewares/upload";
import { IMPORT_MAX_FILE_BYTES } from "../library/csvImport";

export const assetImportRouter = Router();

assetImportRouter.use(authenticate);

// Permisos: create = validar el archivo, iniciar, reanudar y cancelar; read = estado y resultado. Sin grantToUser: el
// admin los asigna por rol. Cada carga solo la ve su dueno o un admin (lo verifica el servicio, no solo el permiso).
assetImportRouter.post(
  "/",
  authorize("asset-imports", "create"),
  // El limite va ANTES de leer el archivo (uploadSingle tambien aplica el suyo y el tope de subidas simultaneas).
  importRateLimiter,
  uploadSingle("file", { kind: "csv", maxFileSizeBytes: IMPORT_MAX_FILE_BYTES }),
  assetImportController.create,
);

// Consultar exige read O create: quien puede iniciar una carga no debe quedar sin poder ver ni descargar la suya.
const canViewImports = authorizeAny("asset-imports", ["read", "create"]);
assetImportRouter.get("/:id", canViewImports, importReadRateLimiter, assetImportController.getStatus);
assetImportRouter.get("/:id/result", canViewImports, importReadRateLimiter, assetImportController.downloadResult);

assetImportRouter.post("/:id/start", authorize("asset-imports", "create"), importRateLimiter, assetImportController.start);
assetImportRouter.post("/:id/resume", authorize("asset-imports", "create"), importRateLimiter, assetImportController.resume);
assetImportRouter.post("/:id/cancel", authorize("asset-imports", "create"), assetImportController.cancel);
