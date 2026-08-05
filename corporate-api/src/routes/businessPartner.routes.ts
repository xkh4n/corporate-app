import { Router } from "express";
import * as businessPartnerController from "../controllers/businessPartner.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const businessPartnerRouter = Router();

businessPartnerRouter.use(authenticate);
businessPartnerRouter.get("/", businessPartnerController.list);
businessPartnerRouter.get("/:id", businessPartnerController.getById);
businessPartnerRouter.post(
  "/",
  authorize("admin"),
  validateBody(businessPartnerController.createBusinessPartnerSchema),
  businessPartnerController.create,
);
businessPartnerRouter.put(
  "/:id",
  authorize("admin"),
  validateBody(businessPartnerController.updateBusinessPartnerSchema),
  businessPartnerController.update,
);
