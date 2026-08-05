import { Router } from "express";
import * as authorizationController from "../controllers/authorization.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { validateBody } from "../library/middlewares/validate";

export const authorizationRouter = Router();

authorizationRouter.use(authenticate);
authorizationRouter.get("/", authorizationController.list);
authorizationRouter.get("/:id", authorizationController.getById);
authorizationRouter.post(
  "/",
  validateBody(authorizationController.createAuthorizationSchema),
  authorizationController.create,
);
