import { Router } from "express";
import { login, logout, refresh, me, loginSchema, refreshSchema } from "../controllers/auth.controller";
import { validateBody } from "../library/middlewares/validate";
import { authenticate } from "../library/middlewares/authenticate";
import { loginRateLimiter } from "../library/middlewares/rateLimit";

export const authRouter = Router();

authRouter.post("/login", loginRateLimiter, validateBody(loginSchema), login);
authRouter.post("/refresh", validateBody(refreshSchema), refresh);
authRouter.post("/logout", logout);
authRouter.get("/me", authenticate, me);
