import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as businessPartnerService from "../services/mssql/businessPartner.service";

export const createBusinessPartnerSchema = z.object({
  legalName: z.string().min(1).max(200),
  nationalId: z.string().min(1).max(20),
  businessLine: z.string().max(150).optional(),
});

export const updateBusinessPartnerSchema = createBusinessPartnerSchema.partial();

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await businessPartnerService.listBusinessPartners());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await businessPartnerService.getBusinessPartnerByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createBusinessPartnerSchema>;
    res
      .status(201)
      .json(await businessPartnerService.createBusinessPartner({ ...body, createdBy: req.user?.userId }));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateBusinessPartnerSchema>;
    res.json(await businessPartnerService.updateBusinessPartner(Number(req.params.id), body));
  } catch (err) {
    next(err);
  }
}
