import { Router } from "express";
import * as userController from "../controllers/user.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { authorize } from "../library/middlewares/authorize";
import { validateBody } from "../library/middlewares/validate";

export const userRouter = Router();

userRouter.use(authenticate, authorize("admin"));

userRouter.get("/", userController.list);
userRouter.get("/:id", userController.getById);
userRouter.post("/", validateBody(userController.createUserSchema), userController.create);
userRouter.put("/:id", validateBody(userController.updateUserSchema), userController.update);
userRouter.patch(
  "/:id/password",
  validateBody(userController.changePasswordSchema),
  userController.changePassword,
);
userRouter.delete("/:id", userController.deactivate);
