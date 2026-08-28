import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as productCategoryService from "../services/mongo/productCategory.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createProductCategorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(255).optional(),
});

export const updateProductCategorySchema = createProductCategorySchema.partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "name");
    const { items, total } = await productCategoryService.listProductCategories(params);
    sendList(res, items, buildPaginationMeta(params, total), "Categorias de producto obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const category = await productCategoryService.getProductCategoryByIdOrThrow(req.params.id as string);
    sendOk(res, category, "Categoria de producto obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createProductCategorySchema>;
    const category = await productCategoryService.createProductCategory(body);
    sendOk(res, category, "Categoria de producto creada exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateProductCategorySchema>;
    const category = await productCategoryService.updateProductCategory(req.params.id as string, body);
    sendOk(res, category, "Categoria de producto actualizada exitosamente");
  } catch (err) {
    next(err);
  }
}
