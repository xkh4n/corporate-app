import { Router } from "express";
import * as addressController from "../controllers/address.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const addressRouter = Router();

addressRouter.use(authenticate);
addressRouter.get("/", authorize("addresses", "read"), addressController.list);
addressRouter.get("/:id", authorize("addresses", "read"), addressController.getById);
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
