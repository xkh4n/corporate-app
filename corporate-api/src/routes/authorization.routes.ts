import { Router } from "express";
import * as authorizationController from "../controllers/authorization.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { uploadSingle } from "../middlewares/upload";
import { validateBody } from "../middlewares/validate";

export const authorizationRouter = Router();

authorizationRouter.use(authenticate);
authorizationRouter.get("/", authorize("authorizations", "read"), authorizationController.list);
authorizationRouter.get(
  "/:id",
  authorize("authorizations", "read"),
  authorizationController.getById,
);
authorizationRouter.post(
  "/",
  authorize("authorizations", "create"),
  validateBody(authorizationController.createAuthorizationSchema),
  authorizationController.create,
);
authorizationRouter.post(
  "/:id/attachment",
  authorize("authorizations", "create"),
  uploadSingle("file"),
  authorizationController.uploadAttachment,
);
