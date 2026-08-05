import { Router } from "express";
import * as lineController from "../controllers/purchaseRequestLine.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { validateBody } from "../library/middlewares/validate";

export const purchaseRequestLineRouter = Router();

purchaseRequestLineRouter.use(authenticate);
purchaseRequestLineRouter.get("/", lineController.list);
purchaseRequestLineRouter.get("/:id", lineController.getById);
purchaseRequestLineRouter.post("/", validateBody(lineController.createLineSchema), lineController.create);
purchaseRequestLineRouter.put("/:id", validateBody(lineController.updateLineSchema), lineController.update);
