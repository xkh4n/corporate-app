import { Router } from "express";
import {
  login,
  logout,
  refresh,
  me,
  menu,
  changePassword,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
} from "../controllers/auth.controller";
import { validateBody } from "../middlewares/validate";
import { authenticateAllowingPasswordChange } from "../middlewares/authenticate";
import { loginRateLimiter } from "../middlewares/rateLimit";

export const authRouter = Router();

authRouter.post("/login", loginRateLimiter, validateBody(loginSchema), login);
authRouter.post("/refresh", validateBody(refreshSchema), refresh);
authRouter.post("/logout", logout);
// Plan 015: las unicas rutas que una cuenta con cambio de password pendiente puede usar.
authRouter.get("/me", authenticateAllowingPasswordChange, me);
authRouter.get("/menu", authenticateAllowingPasswordChange, menu);
authRouter.patch("/change-password", authenticateAllowingPasswordChange, validateBody(changePasswordSchema), changePassword);
