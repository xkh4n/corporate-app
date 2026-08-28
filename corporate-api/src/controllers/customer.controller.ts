import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as customerService from "../services/mssql/customer.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createCustomerSchema = z.object({
  businessPartnerId: z.number().int().positive(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await customerService.listCustomers(params);
    sendList(res, items, buildPaginationMeta(params, total), "Clientes obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const customer = await customerService.getCustomerByIdOrThrow(Number(req.params.id));
    sendOk(res, customer, "Cliente obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createCustomerSchema>;
    const customer = await customerService.createCustomer({ ...body, createdBy: req.user?.userId });
    sendOk(res, customer, "Cliente creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}
