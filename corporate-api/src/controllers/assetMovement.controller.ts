import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as assetMovementService from "../services/postgres/assetMovement.service";
import { BadRequestError } from "../library/errors";

export const createAssetMovementSchema = z.object({
  assetId: z.number().int().positive(),
  movementType: z.enum(["ASSIGNED", "REASSIGNED", "SUPPORT", "DECOMMISSIONED"]),
  userIds: z.array(z.number().int().positive()).optional(),
  notes: z.string().max(255).optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.query.assetId) throw new BadRequestError("Debe indicar assetId como query param");
    res.json(await assetMovementService.listMovementsByAsset(Number(req.query.assetId)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createAssetMovementSchema>;
    res
      .status(201)
      .json(await assetMovementService.createAssetMovement({ ...body, createdBy: req.user?.userId }));
  } catch (err) {
    next(err);
  }
}
