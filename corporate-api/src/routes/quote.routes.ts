import { Router } from "express";
import * as quoteController from "../controllers/quote.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { uploadSingle } from "../middlewares/upload";
import { validateBody } from "../middlewares/validate";

export const quoteRouter = Router();

quoteRouter.use(authenticate);
quoteRouter.get("/", authorize("quotes", "read"), quoteController.list);
quoteRouter.get("/:id", authorize("quotes", "read"), quoteController.getById);
quoteRouter.post(
  "/",
  authorize("quotes", "create"),
  validateBody(quoteController.createQuoteSchema),
  quoteController.create,
);
quoteRouter.post(
  "/:id/attachment",
  authorize("quotes", "create"),
  uploadSingle("file"),
  quoteController.uploadAttachment,
);
