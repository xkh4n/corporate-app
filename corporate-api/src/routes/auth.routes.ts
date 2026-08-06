import { Router } from "express";
import {
  login,
  logout,
  refresh,
  me,
  changePassword,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
} from "../controllers/auth.controller";
import { validateBody } from "../middlewares/validate";
import { authenticate } from "../middlewares/authenticate";
import { loginRateLimiter } from "../middlewares/rateLimit";

export const authRouter = Router();

authRouter.post("/login", loginRateLimiter, validateBody(loginSchema), login);
authRouter.post("/refresh", validateBody(refreshSchema), refresh);
authRouter.post("/logout", logout);
authRouter.get("/me", authenticate, me);
authRouter.patch("/change-password", authenticate, validateBody(changePasswordSchema), changePassword);
