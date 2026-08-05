import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as customerService from "../services/mssql/customer.service";

export const createCustomerSchema = z.object({
  businessPartnerId: z.number().int().positive(),
});

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await customerService.listCustomers());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await customerService.getCustomerByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createCustomerSchema>;
    res.status(201).json(await customerService.createCustomer({ ...body, createdBy: req.user?.userId }));
  } catch (err) {
    next(err);
  }
}
