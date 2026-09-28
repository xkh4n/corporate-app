import { Router } from "express";
import * as productController from "../controllers/product.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize, authorizeAny } from "../middlewares/authorize";
import { uploadSingle } from "../middlewares/upload";
import { validateBody } from "../middlewares/validate";

export const productRouter = Router();

productRouter.use(authenticate);
productRouter.get("/", authorize("products", "read"), productController.list);
productRouter.get("/:id", authorize("products", "read"), productController.getById);
// Sin authorize() a proposito, igual que list/getById de arriba: la imagen
// es tan de solo-lectura/no-sensible como el resto del catalogo.
productRouter.get("/:id/image", productController.getImage);
productRouter.post(
  "/",
  authorize("products", "create"),
  validateBody(productController.createProductSchema),
  productController.create,
);
// Subir/reemplazar la imagen: "create" o "update". Nuevo Producto sube la
// imagen justo despues de crear, y su agrupador no debe llevar products:update
// (que ademas deja editar cualquier producto con PUT /:id).
productRouter.post(
  "/:id/image",
  authorizeAny("products", ["create", "update"]),
  uploadSingle("file"),
  productController.uploadImage,
);
productRouter.put(
  "/:id",
  authorize("products", "update"),
  validateBody(productController.updateProductSchema),
  productController.update,
);
productRouter.delete("/:id", authorize("products", "delete"), productController.deactivate);
