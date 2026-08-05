import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as purchaseRequestService from "../services/mssql/purchaseRequest.service";

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

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await purchaseRequestService.listPurchaseRequests());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await purchaseRequestService.getPurchaseRequestByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createPurchaseRequestSchema>;
    res
      .status(201)
      .json(await purchaseRequestService.createPurchaseRequest({ ...body, createdBy: req.user?.userId }));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updatePurchaseRequestSchema>;
    res.json(await purchaseRequestService.updatePurchaseRequest(Number(req.params.id), body));
  } catch (err) {
    next(err);
  }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status } = req.body as z.infer<typeof updateStatusSchema>;
    res.json(await purchaseRequestService.updatePurchaseRequestStatus(Number(req.params.id), status));
  } catch (err) {
    next(err);
  }
}
