import type { NextFunction, Request, Response } from "express";
import * as cityService from "../services/mssql/city.service";

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await cityService.listCities());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await cityService.getCityByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}
