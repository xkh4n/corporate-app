import { Router } from "express";
import * as userController from "../controllers/user.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";

export const userRouter = Router();

userRouter.use(authenticate);

userRouter.get("/", authorize("users", "read"), userController.list);
userRouter.get("/:id", authorize("users", "read"), userController.getById);

// GET /users/:id/access - usuario + su rol + los permisos de ese rol, en
// una sola respuesta (mismo permiso que GET /:id, es una vista sobre el
// mismo dato).
userRouter.get("/:id/access", authorize("users", "read"), userController.getAccess);
userRouter.post(
  "/",
  authorize("users", "create"),
  validateBody(userController.createUserSchema),
  userController.create,
);
userRouter.patch(
  "/:id",
  authorize("users", "update"),
  validateBody(userController.updateUserSchema),
  userController.update,
);
userRouter.patch(
  "/:id/password",
  authorize("users", "update"),
  validateBody(userController.changePasswordSchema),
  userController.changePassword,
);
userRouter.delete("/:id", authorize("users", "delete"), userController.deactivate);
