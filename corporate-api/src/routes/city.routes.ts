import { Router } from "express";
import * as cityController from "../controllers/city.controller";
import { authenticate } from "../middlewares/authenticate";

export const cityRouter = Router();

// Solo lectura: cities se puebla por seed (initial-data), no via API.
cityRouter.use(authenticate);
cityRouter.get("/", cityController.list);
cityRouter.get("/:id", cityController.getById);
