import { Router } from "express";
import * as lineController from "../controllers/purchaseRequestLine.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const purchaseRequestLineRouter = Router();

purchaseRequestLineRouter.use(authenticate);
purchaseRequestLineRouter.get(
  "/",
  authorize("purchase-request-lines", "read"),
  lineController.list,
);
purchaseRequestLineRouter.get(
  "/:id",
  authorize("purchase-request-lines", "read"),
  lineController.getById,
);
purchaseRequestLineRouter.post(
  "/",
  authorize("purchase-request-lines", "create"),
  validateBody(lineController.createLineSchema),
  lineController.create,
);
purchaseRequestLineRouter.put(
  "/:id",
  authorize("purchase-request-lines", "update"),
  validateBody(lineController.updateLineSchema),
  lineController.update,
);
