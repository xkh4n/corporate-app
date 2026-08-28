import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as supplierContactService from "../services/mssql/supplierContact.service";
import { BadRequestError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk, sendNoContent } from "../library/response";

export const createSupplierContactSchema = z.object({
  supplierId: z.number().int().positive(),
  name: z.string().min(1).max(150),
  email: z.string().email().max(150),
  phone: z.string().max(30).optional(),
  position: z.string().max(100).optional(),
});

export const updateSupplierContactSchema = createSupplierContactSchema.omit({ supplierId: true }).partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.query.supplierId) throw new BadRequestError("Debe indicar supplierId como query param");
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await supplierContactService.listContactsBySupplier(
      Number(req.query.supplierId),
      params,
    );
    sendList(res, items, buildPaginationMeta(params, total), "Contactos del proveedor obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const contact = await supplierContactService.getSupplierContactByIdOrThrow(Number(req.params.id));
    sendOk(res, contact, "Contacto obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createSupplierContactSchema>;
    const contact = await supplierContactService.createSupplierContact({
      ...body,
      createdBy: req.user?.userId,
    });
    sendOk(res, contact, "Contacto creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateSupplierContactSchema>;
    const contact = await supplierContactService.updateSupplierContact(Number(req.params.id), {
      ...body,
      updatedBy: req.user?.userId,
    });
    sendOk(res, contact, "Contacto actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await supplierContactService.deleteSupplierContact(Number(req.params.id));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
