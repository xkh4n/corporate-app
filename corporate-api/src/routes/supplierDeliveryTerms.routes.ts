import { Router } from "express";
import * as supplierDeliveryTermsController from "../controllers/supplierDeliveryTerms.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const supplierDeliveryTermsRouter = Router();

supplierDeliveryTermsRouter.use(authenticate);
supplierDeliveryTermsRouter.get("/", supplierDeliveryTermsController.list);
supplierDeliveryTermsRouter.get("/:id", supplierDeliveryTermsController.getById);
supplierDeliveryTermsRouter.post(
  "/",
  authorize("supplier-delivery-terms", "create"),
  validateBody(supplierDeliveryTermsController.createSupplierDeliveryTermsSchema),
  supplierDeliveryTermsController.create,
);
supplierDeliveryTermsRouter.put(
  "/:id",
  authorize("supplier-delivery-terms", "update"),
  validateBody(supplierDeliveryTermsController.updateSupplierDeliveryTermsSchema),
  supplierDeliveryTermsController.update,
);
