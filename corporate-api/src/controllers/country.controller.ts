import type { NextFunction, Request, Response } from "express";
import * as countryService from "../services/mssql/country.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "nameCountry");
    const { items, total } = await countryService.listCountries(params);
    sendList(res, items, buildPaginationMeta(params, total), "Paises obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const country = await countryService.getCountryByIdOrThrow(Number(req.params.id));
    sendOk(res, country, "Pais obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}
