import type { NextFunction, Request, Response } from "express";
import * as permissionService from "../services/postgres/permission.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList } from "../library/response";

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "resource");
    const { items, total } = await permissionService.listPermissions(params);
    sendList(res, items, buildPaginationMeta(params, total), "Permisos obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}
