import { Router } from "express";
import * as addressController from "../controllers/address.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const addressRouter = Router();

addressRouter.use(authenticate);
addressRouter.get("/", addressController.list);
addressRouter.get("/:id", addressController.getById);
addressRouter.post(
  "/",
  authorize("addresses", "create"),
  validateBody(addressController.createAddressSchema),
  addressController.create,
);
addressRouter.put(
  "/:id",
  authorize("addresses", "update"),
  validateBody(addressController.updateAddressSchema),
  addressController.update,
);
