import { Router } from "express";
import * as businessPartnerController from "../controllers/businessPartner.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const businessPartnerRouter = Router();

businessPartnerRouter.use(authenticate);
businessPartnerRouter.get(
  "/",
  authorize("business-partners", "read"),
  businessPartnerController.list,
);
businessPartnerRouter.get(
  "/:id",
  authorize("business-partners", "read"),
  businessPartnerController.getById,
);
businessPartnerRouter.post(
  "/",
  authorize("business-partners", "create"),
  validateBody(businessPartnerController.createBusinessPartnerSchema),
  businessPartnerController.create,
);
businessPartnerRouter.put(
  "/:id",
  authorize("business-partners", "update"),
  validateBody(businessPartnerController.updateBusinessPartnerSchema),
  businessPartnerController.update,
);
