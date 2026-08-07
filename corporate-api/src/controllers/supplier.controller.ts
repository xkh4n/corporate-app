import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as supplierService from "../services/mssql/supplier.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createSupplierSchema = z.object({
  businessPartnerId: z.number().int().positive(),
  serviceTypeId: z.number().int().positive(),
  paymentTermDays: z.number().int().min(0).optional(),
  deliveryTermsId: z.number().int().positive(),
});

export const updateSupplierSchema = createSupplierSchema.omit({ businessPartnerId: true }).partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await supplierService.listSuppliers(params);
    sendList(res, items, buildPaginationMeta(params, total), "Proveedores obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const supplier = await supplierService.getSupplierByIdOrThrow(Number(req.params.id));
    sendOk(res, supplier, "Proveedor obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createSupplierSchema>;
    const supplier = await supplierService.createSupplier({ ...body, createdBy: req.user?.userId });
    sendOk(res, supplier, "Proveedor creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateSupplierSchema>;
    const supplier = await supplierService.updateSupplier(Number(req.params.id), {
      ...body,
      updatedBy: req.user?.userId,
    });
    sendOk(res, supplier, "Proveedor actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}
