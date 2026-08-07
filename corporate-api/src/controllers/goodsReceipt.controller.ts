import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as goodsReceiptService from "../services/mssql/goodsReceipt.service";
import { BadRequestError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export async function uploadAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new BadRequestError("Debe adjuntar un archivo (campo 'file')");
    const filename = await goodsReceiptService.attachGoodsReceiptDocument(Number(req.params.id), req.file);
    sendOk(res, { filename }, "Documento de recepcion adjuntado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export const createGoodsReceiptSchema = z.object({
  documentType: z.enum(["GUIA_DESPACHO", "BOLETA", "FACTURA"]),
  documentNumber: z.string().min(1).max(50),
  purchaseOrderId: z.number().int().positive(),
  receivedQuantity: z.number().int().positive(),
  serialNumber: z.string().max(100).optional(),
  warrantyExpiresAt: z.string().date().optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.query.purchaseOrderId) throw new BadRequestError("Debe indicar purchaseOrderId como query param");
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await goodsReceiptService.listGoodsReceiptsByOrder(
      Number(req.query.purchaseOrderId),
      params,
    );
    sendList(res, items, buildPaginationMeta(params, total), "Documentos de recepcion obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const receipt = await goodsReceiptService.getGoodsReceiptByIdOrThrow(Number(req.params.id));
    sendOk(res, receipt, "Documento de recepcion obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createGoodsReceiptSchema>;
    const receipt = await goodsReceiptService.createGoodsReceipt({ ...body, createdBy: req.user?.userId });
    sendOk(res, receipt, "Documento de recepcion creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}
