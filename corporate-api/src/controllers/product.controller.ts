import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as productService from "../services/mongo/product.service";

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

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await productService.listProducts());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await productService.getProductByIdOrThrow(req.params.id as string));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createProductSchema>;
    res.status(201).json(await productService.createProduct(body));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateProductSchema>;
    res.json(await productService.updateProduct(req.params.id as string, body));
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await productService.deactivateProduct(req.params.id as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
