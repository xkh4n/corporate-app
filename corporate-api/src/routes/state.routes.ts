import { Router } from "express";
import * as stateController from "../controllers/state.controller";
import { authenticate } from "../library/middlewares/authenticate";

export const stateRouter = Router();

// Solo lectura: states se puebla por seed (initial-data), no via API.
stateRouter.use(authenticate);
stateRouter.get("/", stateController.list);
stateRouter.get("/:id", stateController.getById);
