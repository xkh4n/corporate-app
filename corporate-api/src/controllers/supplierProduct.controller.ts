import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as supplierProductService from "../services/mssql/supplierProduct.service";
import { BadRequestError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk, sendNoContent } from "../library/response";

export const linkSupplierProductSchema = z.object({
  supplierId: z.number().int().positive(),
  productId: z.string().length(24),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");

    if (req.query.supplierId) {
      const { items, total } = await supplierProductService.listProductsBySupplier(
        Number(req.query.supplierId),
        params,
      );
      sendList(res, items, buildPaginationMeta(params, total), "Productos del proveedor obtenidos exitosamente");
      return;
    }

    if (req.query.productId) {
      const { items, total } = await supplierProductService.listSuppliersByProduct(
        String(req.query.productId),
        params,
      );
      sendList(res, items, buildPaginationMeta(params, total), "Proveedores del producto obtenidos exitosamente");
      return;
    }

    throw new BadRequestError("Debe indicar supplierId o productId como query param");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof linkSupplierProductSchema>;
    const link = await supplierProductService.linkSupplierProduct({ ...body, createdBy: req.user?.userId });
    sendOk(res, link, "Producto vinculado al proveedor exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await supplierProductService.unlinkSupplierProduct(Number(req.params.id));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
