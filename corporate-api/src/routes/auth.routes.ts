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
import * as mfa from "../controllers/mfa.controller";
import { authenticate, authenticateAllowingPending } from "../middlewares/authenticate";
import { loginRateLimiter, mfaManageRateLimiter, mfaPendingRateLimiter } from "../middlewares/rateLimit";

export const authRouter = Router();

authRouter.post("/login", loginRateLimiter, validateBody(loginSchema), login);
authRouter.post("/refresh", validateBody(refreshSchema), refresh);
authRouter.post("/logout", logout);
// Planes 015 y 017: las unicas rutas (junto con /auth/mfa/enroll/*) que una cuenta con cambio de
// password o enrolamiento de MFA pendiente puede usar.
authRouter.get("/me", authenticateAllowingPending, me);
authRouter.get("/menu", authenticateAllowingPending, menu);
authRouter.patch("/change-password", authenticateAllowingPending, validateBody(changePasswordSchema), changePassword);

// Plan 017: segundo factor (ver controllers/mfa.controller.ts).
// Login a medio camino: sin authenticate (todavia no hay usuario), identificado por la cookie o mfaToken.
authRouter.post("/mfa/email/send", mfaPendingRateLimiter, validateBody(mfa.pendingSchema), mfa.pendingEmailSend);
authRouter.post("/mfa/webauthn/options", mfaPendingRateLimiter, validateBody(mfa.pendingSchema), mfa.pendingWebauthnOptions);
authRouter.post("/mfa/verify", mfaPendingRateLimiter, validateBody(mfa.verifySchema), mfa.pendingVerify);

// Enrolamiento: tambien con el enrolamiento obligatorio pendiente (es justamente para resolverlo).
const enrollRouter = Router();
enrollRouter.use(authenticateAllowingPending, mfaManageRateLimiter);
enrollRouter.post("/totp/start", mfa.enrollTotpStart);
enrollRouter.post("/totp/confirm", validateBody(mfa.codeSchema), mfa.enrollTotpConfirm);
enrollRouter.post("/email/send", mfa.enrollEmailSend);
enrollRouter.post("/email/confirm", validateBody(mfa.codeSchema), mfa.enrollEmailConfirm);
enrollRouter.post("/webauthn/options", mfa.enrollWebauthnOptions);
enrollRouter.post("/webauthn/verify", validateBody(mfa.webauthnRegisterSchema), mfa.enrollWebauthnVerify);
authRouter.use("/mfa/enroll", enrollRouter);

authRouter.get("/mfa/factors", authenticateAllowingPending, mfa.listFactors);

// Step-up: tambien con el enrolamiento pendiente (solo por correo, ver stepUpMethods), para renovar
// la verificacion vencida en la pantalla de enrolamiento obligatorio.
authRouter.post("/mfa/step-up/email/send", authenticateAllowingPending, mfaManageRateLimiter, mfa.stepUpEmailSend);
authRouter.post("/mfa/step-up/webauthn/options", authenticate, mfaManageRateLimiter, mfa.stepUpWebauthnOptions);
authRouter.post("/mfa/step-up", authenticateAllowingPending, mfaManageRateLimiter, validateBody(mfa.stepUpSchema), mfa.stepUp);
// Administracion de los propios factores: sesion completa, y las bajas piden step-up reciente.
authRouter.delete("/mfa/totp", authenticate, mfaManageRateLimiter, mfa.removeTotp);
authRouter.delete("/mfa/email", authenticate, mfaManageRateLimiter, mfa.removeEmail);
authRouter.delete("/mfa/webauthn/:id", authenticate, mfaManageRateLimiter, mfa.removeWebauthn);
authRouter.patch("/mfa/webauthn/:id", authenticate, mfaManageRateLimiter, validateBody(mfa.renameCredentialSchema), mfa.renameWebauthn);
authRouter.post("/mfa/recovery-codes", authenticate, mfaManageRateLimiter, mfa.regenerateRecoveryCodes);
