import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as supplierDeliveryTermsService from "../services/mssql/supplierDeliveryTerms.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createSupplierDeliveryTermsSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  description: z.string().max(255).optional(),
});

export const updateSupplierDeliveryTermsSchema = createSupplierDeliveryTermsSchema
  .omit({ code: true })
  .partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await supplierDeliveryTermsService.listSupplierDeliveryTerms(params);
    sendList(
      res,
      items,
      buildPaginationMeta(params, total),
      "Condiciones de entrega de proveedor obtenidas exitosamente",
    );
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deliveryTerms = await supplierDeliveryTermsService.getSupplierDeliveryTermsByIdOrThrow(
      Number(req.params.id),
    );
    sendOk(res, deliveryTerms, "Condicion de entrega de proveedor obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createSupplierDeliveryTermsSchema>;
    const deliveryTerms = await supplierDeliveryTermsService.createSupplierDeliveryTerms({
      ...body,
      createdBy: req.user?.userId,
    });
    sendOk(res, deliveryTerms, "Condicion de entrega de proveedor creada exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateSupplierDeliveryTermsSchema>;
    const deliveryTerms = await supplierDeliveryTermsService.updateSupplierDeliveryTerms(Number(req.params.id), {
      ...body,
      updatedBy: req.user?.userId,
    });
    sendOk(res, deliveryTerms, "Condicion de entrega de proveedor actualizada exitosamente");
  } catch (err) {
    next(err);
  }
}
