import type { NextFunction, Request, Response } from "express";
import * as countryService from "../services/mssql/country.service";

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await countryService.listCountries());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await countryService.getCountryByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}
