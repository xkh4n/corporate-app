import { Router } from "express";
import * as supplierContactController from "../controllers/supplierContact.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const supplierContactRouter = Router();

supplierContactRouter.use(authenticate);
// GET requiere ?supplierId=X -sin ese filtro no tiene sentido (no hay
// listado "todos los contactos de todos los proveedores").
supplierContactRouter.get(
  "/",
  authorize("supplier-contacts", "read"),
  supplierContactController.list,
);
supplierContactRouter.get(
  "/:id",
  authorize("supplier-contacts", "read"),
  supplierContactController.getById,
);
supplierContactRouter.post(
  "/",
  authorize("supplier-contacts", "create"),
  validateBody(supplierContactController.createSupplierContactSchema),
  supplierContactController.create,
);
supplierContactRouter.put(
  "/:id",
  authorize("supplier-contacts", "update"),
  validateBody(supplierContactController.updateSupplierContactSchema),
  supplierContactController.update,
);
supplierContactRouter.delete(
  "/:id",
  authorize("supplier-contacts", "delete"),
  supplierContactController.remove,
);
