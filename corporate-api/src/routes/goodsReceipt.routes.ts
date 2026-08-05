import { Router } from "express";
import * as goodsReceiptController from "../controllers/goodsReceipt.controller";
import { authenticate } from "../middlewares/authenticate";
import { validateBody } from "../middlewares/validate";

export const goodsReceiptRouter = Router();

goodsReceiptRouter.use(authenticate);
goodsReceiptRouter.get("/", goodsReceiptController.list);
goodsReceiptRouter.get("/:id", goodsReceiptController.getById);
goodsReceiptRouter.post(
  "/",
  validateBody(goodsReceiptController.createGoodsReceiptSchema),
  goodsReceiptController.create,
);
