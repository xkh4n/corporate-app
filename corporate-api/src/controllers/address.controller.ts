import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as addressService from "../services/mssql/address.service";
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
    const personId = req.query.personId ? Number(req.query.personId) : undefined;
    const businessPartnerId = req.query.businessPartnerId ? Number(req.query.businessPartnerId) : undefined;
    if (personId !== undefined) {
      res.json(await addressService.listAddressesByPerson(personId));
      return;
    }
    if (businessPartnerId !== undefined) {
      res.json(await addressService.listAddressesByBusinessPartner(businessPartnerId));
      return;
    }
    throw new BadRequestError("Debe indicar personId o businessPartnerId como query param");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await addressService.getAddressByIdOrThrow(Number(req.params.id)));
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
    res.status(201).json(await addressService.createAddress(input));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateAddressSchema>;
    res.json(await addressService.updateAddress(Number(req.params.id), body));
  } catch (err) {
    next(err);
  }
}
