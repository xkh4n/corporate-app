import { Router } from "express";
import * as notificationController from "../controllers/notification.controller";
import { authenticate } from "../middlewares/authenticate";

export const notificationRouter = Router();

notificationRouter.use(authenticate);
notificationRouter.get("/pending-summary", notificationController.getPendingSummary);
