import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as productService from "../services/mongo/product.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk, sendNoContent } from "../library/response";

export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  productType: z.enum(["LEASE", "SERVICE", "PURCHASE"]),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  productType: z.enum(["LEASE", "SERVICE", "PURCHASE"]).optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "name");
    const { items, total } = await productService.listProducts(params);
    sendList(res, items, buildPaginationMeta(params, total), "Productos obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await productService.getProductByIdOrThrow(req.params.id as string);
    sendOk(res, product, "Producto obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createProductSchema>;
    const product = await productService.createProduct(body);
    sendOk(res, product, "Producto creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateProductSchema>;
    const product = await productService.updateProduct(req.params.id as string, body);
    sendOk(res, product, "Producto actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await productService.deactivateProduct(req.params.id as string);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
