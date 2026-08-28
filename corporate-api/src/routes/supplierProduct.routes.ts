import { Router } from "express";
import * as supplierProductController from "../controllers/supplierProduct.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const supplierProductRouter = Router();

supplierProductRouter.use(authenticate);
// GET requiere ?supplierId=X (productos de ese proveedor) o ?productId=X
// (proveedores de ese producto) -sin uno de los dos no tiene sentido (no hay
// listado "todos los vinculos de todos los proveedores").
supplierProductRouter.get(
  "/",
  authorize("supplier-products", "read"),
  supplierProductController.list,
);
supplierProductRouter.post(
  "/",
  authorize("supplier-products", "create"),
  validateBody(supplierProductController.linkSupplierProductSchema),
  supplierProductController.create,
);
supplierProductRouter.delete(
  "/:id",
  authorize("supplier-products", "delete"),
  supplierProductController.remove,
);
