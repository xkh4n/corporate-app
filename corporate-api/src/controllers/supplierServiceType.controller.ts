import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as supplierServiceTypeService from "../services/mssql/supplierServiceType.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createSupplierServiceTypeSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  description: z.string().max(255).optional(),
});

export const updateSupplierServiceTypeSchema = createSupplierServiceTypeSchema
  .omit({ code: true })
  .partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await supplierServiceTypeService.listSupplierServiceTypes(params);
    sendList(res, items, buildPaginationMeta(params, total), "Tipos de servicio de proveedor obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const serviceType = await supplierServiceTypeService.getSupplierServiceTypeByIdOrThrow(Number(req.params.id));
    sendOk(res, serviceType, "Tipo de servicio de proveedor obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createSupplierServiceTypeSchema>;
    const serviceType = await supplierServiceTypeService.createSupplierServiceType({
      ...body,
      createdBy: req.user?.userId,
    });
    sendOk(res, serviceType, "Tipo de servicio de proveedor creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateSupplierServiceTypeSchema>;
    const serviceType = await supplierServiceTypeService.updateSupplierServiceType(Number(req.params.id), {
      ...body,
      updatedBy: req.user?.userId,
    });
    sendOk(res, serviceType, "Tipo de servicio de proveedor actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}
