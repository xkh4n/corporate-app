import { Router } from "express";
import * as supplierController from "../controllers/supplier.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const supplierRouter = Router();

supplierRouter.use(authenticate);
supplierRouter.get("/", authorize("suppliers", "read"), supplierController.list);
supplierRouter.get("/:id", authorize("suppliers", "read"), supplierController.getById);
supplierRouter.post(
  "/",
  authorize("suppliers", "create"),
  validateBody(supplierController.createSupplierSchema),
  supplierController.create,
);
supplierRouter.put(
  "/:id",
  authorize("suppliers", "update"),
  validateBody(supplierController.updateSupplierSchema),
  supplierController.update,
);
