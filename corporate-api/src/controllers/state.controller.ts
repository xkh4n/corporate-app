import type { NextFunction, Request, Response } from "express";
import * as stateService from "../services/mssql/state.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "nameState");
    const { items, total } = await stateService.listStates(params);
    sendList(res, items, buildPaginationMeta(params, total), "Estados/comunas obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const state = await stateService.getStateByIdOrThrow(Number(req.params.id));
    sendOk(res, state, "Estado/comuna obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}
