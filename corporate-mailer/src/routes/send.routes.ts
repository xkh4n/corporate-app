import { Router } from "express";
import * as sendController from "../controllers/send.controller";
import { verifySharedSecret } from "../middlewares/verifySharedSecret";

export const sendRouter = Router();

sendRouter.post("/", verifySharedSecret, sendController.send);
