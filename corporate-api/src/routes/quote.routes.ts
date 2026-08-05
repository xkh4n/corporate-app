import { Router } from "express";
import * as quoteController from "../controllers/quote.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { validateBody } from "../library/middlewares/validate";

export const quoteRouter = Router();

quoteRouter.use(authenticate);
quoteRouter.get("/", quoteController.list);
quoteRouter.get("/:id", quoteController.getById);
quoteRouter.post("/", validateBody(quoteController.createQuoteSchema), quoteController.create);
