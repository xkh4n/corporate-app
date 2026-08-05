import type { NextFunction, Request, Response } from "express";
import * as stateService from "../services/mssql/state.service";

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await stateService.listStates());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await stateService.getStateByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}
