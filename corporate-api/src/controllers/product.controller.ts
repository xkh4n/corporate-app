import path from "node:path";
import fs from "node:fs";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { isValidObjectId } from "mongoose";
import * as productService from "../services/mongo/product.service";
import { getProductImagesFolder } from "../library/documentStorage";
import { BadRequestError, NotFoundError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk, sendNoContent } from "../library/response";

export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  productType: z.enum(["ARRIENDO", "SERVICIO", "COMPRA"]),
  categoryId: z.string().length(24).optional(),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  productType: z.enum(["ARRIENDO", "SERVICIO", "COMPRA"]).optional(),
  categoryId: z.string().length(24).optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "name");
    const categoryId = typeof req.query.categoryId === "string" && req.query.categoryId ? req.query.categoryId : undefined;
    if (categoryId !== undefined && !isValidObjectId(categoryId)) throw new BadRequestError("categoryId invalido");
    const { items, total } = await productService.listProducts(params, categoryId);
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

// No pasa por makeAttachmentHandler (middlewares/upload.ts): esa factory
// esta tipada para ids numericos (Number(req.params.id)) -las 3 rutas que
// la usan hoy son entidades MSSQL. El id de Product es un ObjectId string,
// Number(...) lo hubiera roto (NaN).
export async function uploadImage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new BadRequestError("Debe adjuntar un archivo (campo 'file')");
    const filename = await productService.attachProductImage(req.params.id as string, req.file);
    sendOk(res, { filename }, "Imagen de producto adjuntada exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

// Sirve el archivo inline (res.sendFile, NO res.download): un <img src=...>
// necesita que el Content-Type sea el de la imagen, no un
// "Content-Disposition: attachment" que dispare una descarga.
export async function getImage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await productService.getProductByIdOrThrow(req.params.id as string);
    if (!product.image) throw new NotFoundError("El producto no tiene imagen");

    // Contencion por path RESUELTO, no por comparacion de string sobre el
    // nombre (mismo criterio que downloadQuoteDocumentFile en
    // purchaseRequest.controller.ts, hallazgo de auditoria 2026-08-07).
    const folder = path.resolve(getProductImagesFolder());
    const filePath = path.resolve(folder, path.basename(product.image));
    if (!filePath.startsWith(folder + path.sep)) throw new NotFoundError("Imagen no encontrada");
    if (!fs.existsSync(filePath)) throw new NotFoundError("Imagen no encontrada");

    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
}
