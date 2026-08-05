import { Router } from "express";
import * as customerController from "../controllers/customer.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { authorize } from "../library/middlewares/authorize";
import { validateBody } from "../library/middlewares/validate";

export const customerRouter = Router();

customerRouter.use(authenticate);
customerRouter.get("/", customerController.list);
customerRouter.get("/:id", customerController.getById);
customerRouter.post(
  "/",
  authorize("admin"),
  validateBody(customerController.createCustomerSchema),
  customerController.create,
);
