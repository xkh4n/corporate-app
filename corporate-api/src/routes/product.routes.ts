import { Router } from "express";
import * as productController from "../controllers/product.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

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
