import { Router } from "express";
import * as quoteController from "../controllers/quote.controller";
import { authenticate } from "../middlewares/authenticate";
import { validateBody } from "../middlewares/validate";

export const quoteRouter = Router();

quoteRouter.use(authenticate);
quoteRouter.get("/", quoteController.list);
quoteRouter.get("/:id", quoteController.getById);
quoteRouter.post("/", validateBody(quoteController.createQuoteSchema), quoteController.create);
