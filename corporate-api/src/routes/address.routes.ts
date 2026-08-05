import { Router } from "express";
import * as addressController from "../controllers/address.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { validateBody } from "../library/middlewares/validate";

export const addressRouter = Router();

addressRouter.use(authenticate);
addressRouter.get("/", addressController.list);
addressRouter.get("/:id", addressController.getById);
addressRouter.post("/", validateBody(addressController.createAddressSchema), addressController.create);
addressRouter.put("/:id", validateBody(addressController.updateAddressSchema), addressController.update);
