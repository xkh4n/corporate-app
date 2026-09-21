import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as goodsReceiptService from "../services/mssql/goodsReceipt.service";
import { makeAttachmentHandler } from "../middlewares/upload";
import { BadRequestError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const uploadAttachment = makeAttachmentHandler(
  goodsReceiptService.attachGoodsReceiptDocument,
  "Documento de recepcion adjuntado exitosamente",
);

// serialNumbers: un elemento por unidad recibida (decision B, ver
// asset.types.ts) -si viene, tiene que calzar exacto con receivedQuantity o
// no se sabria a que unidad corresponde cada serie. Es opcional del todo:
// no todo producto recibido tiene numero de serie propio.
export const createGoodsReceiptSchema = z
  .object({
    documentType: z.enum(["GUIA_DESPACHO", "BOLETA", "FACTURA"]),
    documentNumber: z.string().min(1).max(50),
    purchaseOrderId: z.number().int().positive(),
    // Una OC cubre varias cotizaciones ganadoras: hay que decir contra cual
    // se esta recepcionando (validado contra purchase_order_quotes).
    quoteId: z.number().int().positive(),
    receivedQuantity: z.number().int().positive(),
    serialNumbers: z.array(z.string().max(100).nullable()).optional(),
    warrantyExpiresAt: z.string().date().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.serialNumbers && data.serialNumbers.length !== data.receivedQuantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serialNumbers"],
        message: `Debe indicar exactamente ${data.receivedQuantity} numeros de serie (uno por unidad) o ninguno`,
      });
    }
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
