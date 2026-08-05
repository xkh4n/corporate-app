import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as purchaseRequestService from "../services/mssql/purchaseRequest.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createPurchaseRequestSchema = z.object({
  requesterId: z.number().int().positive(),
  beneficiaryId: z.number().int().positive(),
  costCenterId: z.number().int().positive(),
  requesterPosition: z.string().max(100).optional(),
  requesterEmail: z.string().email().max(150).optional(),
  requesterPhone: z.string().max(30).optional(),
  beneficiaryPhone: z.string().max(30).optional(),
  beneficiaryUserId: z.number().int().positive().optional(),
  notes: z.string().max(500).optional(),
  priority: z.string().max(20).optional(),
});

export const updatePurchaseRequestSchema = createPurchaseRequestSchema
  .omit({ requesterId: true, beneficiaryId: true, costCenterId: true })
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
    const request = await purchaseRequestService.updatePurchaseRequest(Number(req.params.id), body);
    sendOk(res, request, "Solicitud actualizada exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status } = req.body as z.infer<typeof updateStatusSchema>;
    const request = await purchaseRequestService.updatePurchaseRequestStatus(Number(req.params.id), status);
    sendOk(res, request, "Estado de la solicitud actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}
