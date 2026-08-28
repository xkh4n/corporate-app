import express, { Router } from "express";
import * as sendController from "../controllers/send.controller";
import { verifySharedSecret } from "../middlewares/verifySharedSecret";

export const sendRouter = Router();

// verifySharedSecret ANTES de parsear el body (hallazgo de auditoria de
// seguridad): el header no depende del body, asi que un request sin
// "X-Mailer-Token" valido se rechaza con 401 antes de que el parser de JSON
// (20mb, para adjuntos PDF en base64) toque un solo byte del payload.
sendRouter.post("/", verifySharedSecret, express.json({ limit: "20mb" }), sendController.send);
