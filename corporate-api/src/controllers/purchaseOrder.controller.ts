import path from "node:path";
import fs from "node:fs";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as purchaseOrderService from "../services/mssql/purchaseOrder.service";
import { makeAttachmentHandler } from "../middlewares/upload";
import { NotFoundError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const uploadAttachment = makeAttachmentHandler(
  purchaseOrderService.attachPurchaseOrderDocument,
  "Documento de orden de compra adjuntado exitosamente",
);

export const createPurchaseOrderSchema = z.object({
  // Una OC cubre N cotizaciones ganadoras; el servidor valida que todas sean
  // de la misma solicitud y del mismo proveedor (ver createPurchaseOrder).
  quoteIds: z.array(z.number().int().positive()).min(1),
  paymentTerms: z.string().max(50).optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestId = req.query.requestId ? Number(req.query.requestId) : undefined;
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id", "desc");
    const { items, total } = await purchaseOrderService.listPurchaseOrders(params, requestId);
    sendList(res, items, buildPaginationMeta(params, total), "Ordenes de compra obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const order = await purchaseOrderService.getPurchaseOrderByIdOrThrow(Number(req.params.id));
    sendOk(res, order, "Orden de compra obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createPurchaseOrderSchema>;
    const order = await purchaseOrderService.createPurchaseOrder(
      { ...body, createdBy: req.user?.userId },
      req.user!.personId,
    );
    sendOk(res, order, "Orden de compra creada exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

// Para que el analista pueda revisar, antes de enviar, que documentos ya se
// consolidaron en la carpeta de la adquisicion (OC-*, y el SOLCOT-*/COT-* de
// la cotizacion ganadora que createAuthorization ya copio ahi).
export async function listDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const files = await purchaseOrderService.listAcquisitionDocuments(Number(req.params.id));
    sendOk(res, { files }, "Documentos de la orden de compra obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

// Mismo guard anti path-traversal que downloadQuoteDocumentFile en
// purchaseRequest.controller.ts: contencion por ruta RESUELTA, no por
// comparacion de string.
export async function downloadDocumentFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filename = String(req.params.filename ?? "");
    if (!filename) throw new NotFoundError("Archivo no encontrado");

    const folder = path.resolve(await purchaseOrderService.getAcquisitionFolderForOrder(Number(req.params.id)));
    const filePath = path.resolve(folder, filename);
    if (!filePath.startsWith(folder + path.sep)) throw new NotFoundError("Archivo no encontrado");
    if (!fs.existsSync(filePath)) throw new NotFoundError("Archivo no encontrado");

    res.download(filePath, filename);
  } catch (err) {
    next(err);
  }
}

// Nunca responde 500/crash por un fallo de correo: sendPurchaseOrderToSupplier
// ya devuelve {sent:false, message} en vez de lanzar cuando el mailer no
// responde -acá solo se traduce a 502, mismo criterio que sendQuoteEmail en
// purchaseRequest.controller.ts.
export async function sendToSupplier(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await purchaseOrderService.sendPurchaseOrderToSupplier(Number(req.params.id), req.user!.userId);
    if (!result.sent) {
      res.status(502).json({ codigo: 502, message: result.message });
      return;
    }
    sendOk(res, { sent: true }, result.message);
  } catch (err) {
    next(err);
  }
}
