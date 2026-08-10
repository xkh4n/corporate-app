import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as menuItemService from "../services/postgres/menuItem.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk, sendNoContent } from "../library/response";

export const createMenuItemSchema = z.object({
  label: z.string().min(1).max(100),
  icon: z.string().max(50).optional(),
  link: z.string().max(255).optional(),
  parentId: z.number().int().positive().optional(),
  permissionId: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
});

export const updateMenuItemSchema = createMenuItemSchema.partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "sortOrder");
    const { items, total } = await menuItemService.listMenuItems(params);
    sendList(res, items, buildPaginationMeta(params, total), "Items de menu obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const menuItem = await menuItemService.getMenuItemByIdOrThrow(Number(req.params.id));
    sendOk(res, menuItem, "Item de menu obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createMenuItemSchema>;
    const menuItem = await menuItemService.createMenuItem(body);
    sendOk(res, menuItem, "Item de menu creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateMenuItemSchema>;
    const menuItem = await menuItemService.updateMenuItem(Number(req.params.id), body);
    sendOk(res, menuItem, "Item de menu actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await menuItemService.deactivateMenuItem(Number(req.params.id));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
