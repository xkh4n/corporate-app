import type { NextFunction, Request, Response } from "express";
import * as cityService from "../services/mssql/city.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "nameCity");
    const { items, total } = await cityService.listCities(params);
    sendList(res, items, buildPaginationMeta(params, total), "Ciudades obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const city = await cityService.getCityByIdOrThrow(Number(req.params.id));
    sendOk(res, city, "Ciudad obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}
