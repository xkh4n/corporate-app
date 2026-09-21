import { Router } from "express";
import * as productCategoryController from "../controllers/productCategory.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const productCategoryRouter = Router();

productCategoryRouter.use(authenticate);
productCategoryRouter.get("/", authorize("product-categories", "read"), productCategoryController.list);
productCategoryRouter.get("/:id", authorize("product-categories", "read"), productCategoryController.getById);
productCategoryRouter.post(
  "/",
  authorize("product-categories", "create"),
  validateBody(productCategoryController.createProductCategorySchema),
  productCategoryController.create,
);
productCategoryRouter.put(
  "/:id",
  authorize("product-categories", "update"),
  validateBody(productCategoryController.updateProductCategorySchema),
  productCategoryController.update,
);
