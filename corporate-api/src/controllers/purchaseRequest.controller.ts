import path from "node:path";
import fs from "node:fs";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as purchaseRequestService from "../services/mssql/purchaseRequest.service";
import { archiveQuoteRequestPdf, renderQuoteRequestPdf } from "../library/pdf/quoteRequestPdf";
import { getQuoteRequestFolder, listFiles } from "../library/documentStorage";
import { NotFoundError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createPurchaseRequestSchema = z.object({
  requesterId: z.number().int().positive(),
  beneficiaryId: z.number().int().positive(),
  costCenterId: z.number().int().positive(),
  // Debe ser un usuario cuyo rol tenga purchase-requests:approve -validado
  // en createPurchaseRequest (service), no solo aca (un id numerico valido
  // no garantiza que ese usuario pueda aprobar).
  approverId: z.number().int().positive(),
  requesterPosition: z.string().max(100).optional(),
  requesterEmail: z.string().email().max(150).optional(),
  requesterPhone: z.string().max(30).optional(),
  beneficiaryPhone: z.string().max(30).optional(),
  beneficiaryUserId: z.number().int().positive().optional(),
  notes: z.string().max(500).optional(),
  priority: z.string().max(20).optional(),
});

// approverId queda fuera de este update a proposito (no solo requesterId/
// beneficiaryId/costCenterId): reasignar aprobador no fue pedido todavia y
// createPurchaseRequest es el unico lugar que hoy valida que el usuario
// elegido realmente pueda aprobar (ver roleGrantsPermission).
export const updatePurchaseRequestSchema = createPurchaseRequestSchema
  .omit({ requesterId: true, beneficiaryId: true, costCenterId: true, approverId: true })
  .partial();

export const updateStatusSchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CLOSED", "CANCELLED"]),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id", "desc");
    const { items, total } = await purchaseRequestService.listPurchaseRequests(params);
    sendList(res, items, buildPaginationMeta(params, total), "Solicitudes obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

// Alimenta el select de aprobador en CreateRequest.tsx: cualquier usuario
// activo cuyo rol tenga purchase-requests:approve. Gateada por
// purchase-requests:create (es quien crea la solicitud el que necesita
// ver esta lista, no un permiso nuevo solo para esto).
export async function listApprovers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const approvers = await purchaseRequestService.listApprovers();
    sendOk(res, approvers, "Aprobadores obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

// Solo lo que le corresponde revisar al usuario logeado (AproveRequest.tsx)
// -distinto de GET / (list), que exige purchase-requests:read y devuelve
// todo. req.user siempre esta seteado aca: authenticate + authorize ya
// corrieron antes de llegar a este handler (ver purchaseRequest.routes.ts).
export async function listMyApprovals(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id", "desc");
    const { items, total } = await purchaseRequestService.listPurchaseRequestsForApprover(
      req.user!.userId,
      params,
    );
    sendList(res, items, buildPaginationMeta(params, total), "Solicitudes por aprobar obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const request = await purchaseRequestService.getPurchaseRequestByIdOrThrow(Number(req.params.id));
    sendOk(res, request, "Solicitud obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createPurchaseRequestSchema>;
    const request = await purchaseRequestService.createPurchaseRequest({
      ...body,
      createdBy: req.user?.userId,
    });
    sendOk(res, request, "Solicitud creada exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updatePurchaseRequestSchema>;
    const request = await purchaseRequestService.updatePurchaseRequest(Number(req.params.id), {
      ...body,
      updatedBy: req.user?.userId,
    });
    sendOk(res, request, "Solicitud actualizada exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status } = req.body as z.infer<typeof updateStatusSchema>;
    const request = await purchaseRequestService.updatePurchaseRequestStatus(
      Number(req.params.id),
      status,
      req.user?.userId,
    );
    sendOk(res, request, "Estado de la solicitud actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}

// PDF descargable: no depende de nada con salida a internet, corre entero
// dentro de este contenedor. Lista TODAS las lineas de la solicitud.
// ?supplierId=X opcional -si se indica, el documento sale dirigido a ese
// proveedor.
export async function downloadQuoteDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
    const data = await purchaseRequestService.getQuoteRequestDocumentData(Number(req.params.id), supplierId);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${data.requestNumber}.pdf"`);
    const doc = renderQuoteRequestPdf(data);
    archiveQuoteRequestPdf(doc, data.requestNumber, data.supplierNationalId);
    doc.pipe(res);
  } catch (err) {
    next(err);
  }
}

// Para que el aprobador pueda revisar, antes de autorizar, que cotizaciones
// (SOLCOT-* generado por el backend, COT-* subido al responder el
// proveedor) ya se acumularon para esta solicitud.
export async function listQuoteDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const request = await purchaseRequestService.getPurchaseRequestByIdOrThrow(Number(req.params.id));
    const files = listFiles(getQuoteRequestFolder(request.requestNumber));
    sendOk(res, { files }, "Documentos de la solicitud obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function downloadQuoteDocumentFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const request = await purchaseRequestService.getPurchaseRequestByIdOrThrow(Number(req.params.id));
    const filename = String(req.params.filename ?? "");
    if (!filename) throw new NotFoundError("Archivo no encontrado");

    // Contencion por ruta RESUELTA, no por comparacion de string: el guard
    // anterior (path.basename(filename) !== filename) dejaba pasar ".."
    // -path.basename("..") devuelve "..", la comparacion no detectaba nada-.
    // Hoy el parametro de ruta de Express ya excluye "/", asi que no se podia
    // bajar mas de un nivel, pero era un defecto real del guard (CWE-22), no
    // un falso positivo (hallazgo de auditoria de seguridad 2026-08-07).
    const folder = path.resolve(getQuoteRequestFolder(request.requestNumber));
    const filePath = path.resolve(folder, filename);
    if (!filePath.startsWith(folder + path.sep)) throw new NotFoundError("Archivo no encontrado");
    if (!fs.existsSync(filePath)) throw new NotFoundError("Archivo no encontrado");

    res.download(filePath, filename);
  } catch (err) {
    next(err);
  }
}

export const sendQuoteEmailSchema = z.object({
  supplierId: z.number().int().positive(),
});

// Nunca responde 500/crash por un fallo de correo: sendQuoteRequestEmail ya
// devuelve {sent:false, message} en vez de lanzar cuando el mailer no
// responde -acá solo se traduce a 502 para que el frontend distinga "no se
// pudo enviar" de un 201/200 real. El PDF sigue disponible por descarga
// manual (downloadQuoteDocument) sin importar si el correo falló.
export async function sendQuoteEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { supplierId } = req.body as z.infer<typeof sendQuoteEmailSchema>;
    const result = await purchaseRequestService.sendQuoteRequestEmail(Number(req.params.id), supplierId);

    if (!result.sent) {
      res.status(502).json({ codigo: 502, message: result.message });
      return;
    }
    sendOk(res, { sent: true }, result.message);
  } catch (err) {
    next(err);
  }
}
