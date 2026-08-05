import { Router } from "express";
import * as customerController from "../controllers/customer.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const customerRouter = Router();

customerRouter.use(authenticate);
customerRouter.get("/", customerController.list);
customerRouter.get("/:id", customerController.getById);
customerRouter.post(
  "/",
  authorize("customers", "create"),
  validateBody(customerController.createCustomerSchema),
  customerController.create,
);
