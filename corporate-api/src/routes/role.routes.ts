import { Router } from "express";
import * as roleController from "../controllers/role.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { authorize } from "../library/middlewares/authorize";
import { validateBody } from "../library/middlewares/validate";

export const roleRouter = Router();

roleRouter.use(authenticate);

roleRouter.get("/", roleController.list);
roleRouter.get("/:id", roleController.getById);
roleRouter.post(
  "/",
  authorize("admin"),
  validateBody(roleController.createRoleSchema),
  roleController.create,
);
roleRouter.put(
  "/:id",
  authorize("admin"),
  validateBody(roleController.updateRoleSchema),
  roleController.update,
);
roleRouter.delete("/:id", authorize("admin"), roleController.deactivate);
