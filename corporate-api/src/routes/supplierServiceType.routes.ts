import { Router } from "express";
import * as supplierServiceTypeController from "../controllers/supplierServiceType.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const supplierServiceTypeRouter = Router();

supplierServiceTypeRouter.use(authenticate);
supplierServiceTypeRouter.get("/", supplierServiceTypeController.list);
supplierServiceTypeRouter.get("/:id", supplierServiceTypeController.getById);
supplierServiceTypeRouter.post(
  "/",
  authorize("supplier-service-types", "create"),
  validateBody(supplierServiceTypeController.createSupplierServiceTypeSchema),
  supplierServiceTypeController.create,
);
supplierServiceTypeRouter.put(
  "/:id",
  authorize("supplier-service-types", "update"),
  validateBody(supplierServiceTypeController.updateSupplierServiceTypeSchema),
  supplierServiceTypeController.update,
);
