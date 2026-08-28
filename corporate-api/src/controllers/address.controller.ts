import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as addressService from "../services/mssql/address.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";
import { BadRequestError } from "../library/errors";

export const createAddressSchema = z
  .object({
    personId: z.number().int().positive().optional(),
    businessPartnerId: z.number().int().positive().optional(),
    addressType: z.string().min(1).max(30),
    addressLine: z.string().min(1).max(255),
    stateId: z.number().int().positive(),
  })
  .refine((data) => (data.personId !== undefined) !== (data.businessPartnerId !== undefined), {
    message: "Debe indicar exactamente uno de personId o businessPartnerId",
  });

export const updateAddressSchema = z.object({
  addressType: z.string().min(1).max(30).optional(),
  addressLine: z.string().min(1).max(255).optional(),
  stateId: z.number().int().positive().optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const personId = req.query.personId ? Number(req.query.personId) : undefined;
    const businessPartnerId = req.query.businessPartnerId ? Number(req.query.businessPartnerId) : undefined;

    if (personId !== undefined) {
      const { items, total } = await addressService.listAddressesByPerson(personId, params);
      sendList(res, items, buildPaginationMeta(params, total), "Direcciones obtenidas exitosamente");
      return;
    }
    if (businessPartnerId !== undefined) {
      const { items, total } = await addressService.listAddressesByBusinessPartner(businessPartnerId, params);
      sendList(res, items, buildPaginationMeta(params, total), "Direcciones obtenidas exitosamente");
      return;
    }
    throw new BadRequestError("Debe indicar personId o businessPartnerId como query param");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const address = await addressService.getAddressByIdOrThrow(Number(req.params.id));
    sendOk(res, address, "Direccion obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createAddressSchema>;
    const input =
      body.personId !== undefined
        ? {
            personId: body.personId,
            addressType: body.addressType,
            addressLine: body.addressLine,
            stateId: body.stateId,
            createdBy: req.user?.userId,
          }
        : {
            businessPartnerId: body.businessPartnerId as number,
            addressType: body.addressType,
            addressLine: body.addressLine,
            stateId: body.stateId,
            createdBy: req.user?.userId,
          };
    const address = await addressService.createAddress(input);
    sendOk(res, address, "Direccion creada exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateAddressSchema>;
    const address = await addressService.updateAddress(Number(req.params.id), {
      ...body,
      updatedBy: req.user?.userId,
    });
    sendOk(res, address, "Direccion actualizada exitosamente");
  } catch (err) {
    next(err);
  }
}
