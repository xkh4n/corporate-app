import { Router } from "express";
import * as productController from "../controllers/product.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { authorize } from "../library/middlewares/authorize";
import { validateBody } from "../library/middlewares/validate";

export const productRouter = Router();

productRouter.use(authenticate);
productRouter.get("/", productController.list);
productRouter.get("/:id", productController.getById);
productRouter.post(
  "/",
  authorize("admin"),
  validateBody(productController.createProductSchema),
  productController.create,
);
productRouter.put(
  "/:id",
  authorize("admin"),
  validateBody(productController.updateProductSchema),
  productController.update,
);
productRouter.delete("/:id", authorize("admin"), productController.deactivate);
