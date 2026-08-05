import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as supplierService from "../services/mssql/supplier.service";

export const createSupplierSchema = z.object({
  businessPartnerId: z.number().int().positive(),
  serviceType: z.enum(["LEASE", "SERVICE", "SALE"]),
  paymentTermDays: z.number().int().min(0).optional(),
  deliveryTerms: z.enum(["ON_PURCHASE_ORDER", "ON_INVOICE"]),
});

export const updateSupplierSchema = createSupplierSchema.omit({ businessPartnerId: true }).partial();

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await supplierService.listSuppliers());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await supplierService.getSupplierByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createSupplierSchema>;
    res.status(201).json(await supplierService.createSupplier({ ...body, createdBy: req.user?.userId }));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateSupplierSchema>;
    res.json(await supplierService.updateSupplier(Number(req.params.id), body));
  } catch (err) {
    next(err);
  }
}
