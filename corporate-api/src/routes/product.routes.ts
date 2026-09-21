import { Router } from "express";
import * as productController from "../controllers/product.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
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
// Subir/reemplazar la imagen se trata como "editar" el producto -no existe
// (ni hace falta) una accion RBAC separada tipo "products:image".
productRouter.post(
  "/:id/image",
  authorize("products", "update"),
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
