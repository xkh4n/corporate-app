import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as businessPartnerService from "../services/mssql/businessPartner.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createBusinessPartnerSchema = z.object({
  legalName: z.string().min(1).max(200),
  nationalId: z.string().min(1).max(20),
  businessLine: z.string().max(150).optional(),
});

export const updateBusinessPartnerSchema = createBusinessPartnerSchema.partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "legalName");
    const { items, total } = await businessPartnerService.listBusinessPartners(params);
    sendList(res, items, buildPaginationMeta(params, total), "Terceros obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const partner = await businessPartnerService.getBusinessPartnerByIdOrThrow(Number(req.params.id));
    sendOk(res, partner, "Tercero obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createBusinessPartnerSchema>;
    const partner = await businessPartnerService.createBusinessPartner({ ...body, createdBy: req.user?.userId });
    sendOk(res, partner, "Tercero creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateBusinessPartnerSchema>;
    const partner = await businessPartnerService.updateBusinessPartner(Number(req.params.id), {
      ...body,
      updatedBy: req.user?.userId,
    });
    sendOk(res, partner, "Tercero actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}
