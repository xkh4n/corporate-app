import { Router } from "express";
import * as supplierController from "../controllers/supplier.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const supplierRouter = Router();

supplierRouter.use(authenticate);
supplierRouter.get("/", supplierController.list);
supplierRouter.get("/:id", supplierController.getById);
supplierRouter.post(
  "/",
  authorize("admin"),
  validateBody(supplierController.createSupplierSchema),
  supplierController.create,
);
supplierRouter.put(
  "/:id",
  authorize("admin"),
  validateBody(supplierController.updateSupplierSchema),
  supplierController.update,
);
