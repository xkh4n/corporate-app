import { Router } from "express";
import * as goodsReceiptController from "../controllers/goodsReceipt.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { uploadSingle } from "../middlewares/upload";
import { validateBody } from "../middlewares/validate";

export const goodsReceiptRouter = Router();

goodsReceiptRouter.use(authenticate);
goodsReceiptRouter.get("/", goodsReceiptController.list);
goodsReceiptRouter.get("/:id", goodsReceiptController.getById);
goodsReceiptRouter.post(
  "/",
  authorize("goods-receipts", "create"),
  validateBody(goodsReceiptController.createGoodsReceiptSchema),
  goodsReceiptController.create,
);
goodsReceiptRouter.post(
  "/:id/attachment",
  authorize("goods-receipts", "create"),
  uploadSingle("file"),
  goodsReceiptController.uploadAttachment,
);
