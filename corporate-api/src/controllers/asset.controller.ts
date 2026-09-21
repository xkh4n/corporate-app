import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as assetService from "../services/postgres/asset.service";
import {
  ASSET_LABEL_DEFAULT_CONFIG,
  renderAssetLabelZpl,
  renderAssetLabelsZpl,
  type AssetLabelConfig,
} from "../library/labels/assetLabelZpl";
import { BadRequestError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

// Sin endpoint de creacion directa: un Asset nace SOLO al confirmar un
// GoodsReceipt (ver services/mssql/goodsReceipt.service.ts) -crearlo suelto
// no tendria de donde sacar el tag/productType.
// value NO se edita aca a proposito: el costo de un activo lo fija la valorizacion (asset-valuation,
// que ademas escribe el asiento de Kardex) o un ajuste de Kardex. Aceptarlo en este PUT (permiso
// assets:update, otorgado a todo usuario) dejaba fijar un valor arbitrario sin asiento.
export const updateAssetSchema = z.object({
  serialNumber: z.string().max(100).optional(),
  warrantyExpiresAt: z.string().date().optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id", "desc");
    const requestId = req.query.requestId ? Number(req.query.requestId) : undefined;
    // requestId: usado por AssignAssets.tsx (Fase E) -reverse-lookup cross-
    // engine sin paginar (ver getAssetsByRequestId), distinto del filtro
    // goodsReceiptId de abajo que si pagina.
    if (requestId !== undefined) {
      const items = await assetService.getAssetsByRequestId(requestId);
      sendList(res, items, buildPaginationMeta(params, items.length), "Activos obtenidos exitosamente");
      return;
    }
    const goodsReceiptId = req.query.goodsReceiptId ? Number(req.query.goodsReceiptId) : undefined;
    const { items, total } = await assetService.listAssets(params, goodsReceiptId);
    sendList(res, items, buildPaginationMeta(params, total), "Activos obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const asset = await assetService.getAssetByIdOrThrow(Number(req.params.id));
    sendOk(res, asset, "Activo obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

const labelConfigSchema = z.object({
  widthMm: z.number().positive().optional(),
  heightMm: z.number().positive().optional(),
  barcodeType: z.enum(["CODE128", "CODE39", "QR"]).optional(),
  showBorder: z.boolean().optional(),
  showProductName: z.boolean().optional(),
  showSerialNumber: z.boolean().optional(),
});

// req.query llega como strings (Express no distingue tipos en la query
// string) -z.coerce convierte "50"->50 y "true"->true antes de validar,
// distinto del body de POST /assets/labels.zpl (JSON real, sin coercion).
const labelConfigQuerySchema = z.object({
  widthMm: z.coerce.number().positive().optional(),
  heightMm: z.coerce.number().positive().optional(),
  barcodeType: z.enum(["CODE128", "CODE39", "QR"]).optional(),
  showBorder: z.coerce.boolean().optional(),
  showProductName: z.coerce.boolean().optional(),
  showSerialNumber: z.coerce.boolean().optional(),
});

export const printAssetLabelsSchema = z.object({
  assetIds: z.array(z.number().int().positive()).min(1).max(200),
  config: labelConfigSchema.optional(),
});

function resolveLabelConfig(raw: z.infer<typeof labelConfigSchema> | undefined): AssetLabelConfig {
  return { ...ASSET_LABEL_DEFAULT_CONFIG, ...raw };
}

// ZPL generado 100% en este backend (texto plano, sin estado); la impresion
// REAL la hace el navegador via WebUSB -este container no tiene salida a la
// LAN donde vive la impresora Zebra (redes internal:true, ver
// compose.dev.yml). Mismo permiso assets:read -la etiqueta no expone nada
// que ese permiso no muestre ya.
export async function downloadLabel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [data] = await assetService.getAssetsLabelData([Number(req.params.id)]);
    if (!data) throw new BadRequestError("El activo no existe");
    const parsedConfig = labelConfigQuerySchema.safeParse(req.query);
    if (!parsedConfig.success) throw new BadRequestError("Configuracion de etiqueta invalida", parsedConfig.error.flatten());
    const config = resolveLabelConfig(parsedConfig.data);
    const zpl = renderAssetLabelZpl(data, config);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${data.tag}.zpl"`);
    res.send(zpl);
  } catch (err) {
    next(err);
  }
}

export async function downloadLabelsBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof printAssetLabelsSchema>;
    const items = await assetService.getAssetsLabelData(body.assetIds);
    const config = resolveLabelConfig(body.config);
    const zpl = renderAssetLabelsZpl(items, config);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="etiquetas-activos.zpl"`);
    res.send(zpl);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateAssetSchema>;
    const asset = await assetService.updateAsset(Number(req.params.id), {
      ...body,
      updatedBy: req.user?.userId,
    });
    sendOk(res, asset, "Activo actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}
