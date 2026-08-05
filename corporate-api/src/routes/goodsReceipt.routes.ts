import { Router } from "express";
import * as goodsReceiptController from "../controllers/goodsReceipt.controller";
import { authenticate } from "../library/middlewares/authenticate";
import { validateBody } from "../library/middlewares/validate";

export const goodsReceiptRouter = Router();

goodsReceiptRouter.use(authenticate);
goodsReceiptRouter.get("/", goodsReceiptController.list);
goodsReceiptRouter.get("/:id", goodsReceiptController.getById);
goodsReceiptRouter.post(
  "/",
  validateBody(goodsReceiptController.createGoodsReceiptSchema),
  goodsReceiptController.create,
);
