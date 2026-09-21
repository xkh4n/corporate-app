import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as inventoryCountService from "../services/postgres/inventoryCount.service";
import { findActiveUserByDocumentId } from "../services/mssql/user.service";
import { ASSET_LABEL_DEFAULT_CONFIG, renderAssetLabelsZpl, type AssetLabelConfig } from "../library/labels/assetLabelZpl";
import { renderInventoryCountReportPdf } from "../library/pdf/inventoryCountReportPdf";
import { BadRequestError, UnauthorizedError } from "../library/errors";
import { buildPaginationMeta, parsePaginationParams } from "../library/pagination";
import { sendList, sendOk } from "../library/response";
import type { InventoryCountActor } from "../types/postgres/inventoryCount.types";

// ObjectId de Mongo en hex (24 caracteres): mismo largo que asserta
// product.controller.ts para categoryId.
const objectIdSchema = z.string().length(24);

const lineStatusSchema = z.enum(["ASSIGNED", "SUPPORT", "AVAILABLE", "DAMAGED", "DECOMMISSIONED"]);

export const startInventoryCountSchema = z.object({
  name: z.string().max(150).nullish(),
  notes: z.string().max(500).nullish(),
});

const lookupBySchema = z.enum(["TAG", "SERIAL"]);

// Igual que el mayor de los campos que se dan de alta (serie: 100).
const MAX_LOOKUP_VALUE_LENGTH = 100;

// lookupBy TAG: tag obligatorio (si no existe en el sistema, el servidor crea un
// activo nuevo con un tag generado -el texto ingresado se descarta- y exige la
// serie). lookupBy SERIAL: serialNumber obligatorio, sirve para encontrar el
// activo (si ya existe se vincula) o para dar de alta uno nuevo con esa serie.
export const addInventoryLineSchema = z
  .object({
    lookupBy: lookupBySchema,
    tag: z.string().max(50).nullish(),
    productCategoryId: objectIdSchema,
    productId: objectIdSchema,
    description: z.string().max(255).nullish(),
    costCenterId: z.number().int().positive(),
    serialNumber: z.string().max(100).nullish(),
    holderUserId: z.number().int().positive().nullish(),
    statusCode: lineStatusSchema,
  })
  .superRefine((value, ctx) => {
    if (value.lookupBy === "TAG" && !value.tag?.trim()) {
      ctx.addIssue({ code: "custom", path: ["tag"], message: "Debe indicar el TAG del equipo" });
    }
    if (value.lookupBy === "SERIAL" && !value.serialNumber?.trim()) {
      ctx.addIssue({ code: "custom", path: ["serialNumber"], message: "Debe indicar la serie del equipo" });
    }
  });

// Solo la descripcion: el resto ya quedo escrito en el activo real.
export const updateInventoryLineSchema = z.object({
  description: z.string().max(255).nullish(),
});

// req.query llega como strings. z.coerce.boolean() convierte "false" en true
// (cualquier string no vacio), asi que los booleanos de la etiqueta se parsean
// explicitamente desde "true"/"false".
const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
const labelConfigQuerySchema = z.object({
  // Tope de 300 mm: un valor enorme (1e308) generaba ZPL invalido (^PWInfinity) en la impresora.
  widthMm: z.coerce.number().positive().max(300).optional(),
  heightMm: z.coerce.number().positive().max(300).optional(),
  barcodeType: z.enum(["CODE128", "CODE39", "QR"]).optional(),
  showBorder: booleanQuery.optional(),
  showProductName: booleanQuery.optional(),
  showSerialNumber: booleanQuery.optional(),
});

function parseId(value: unknown, label: string): number {
  const id = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError(`${label} invalido`);
  return id;
}

function requireUserId(req: Request): number {
  const userId = req.user?.userId;
  if (userId === undefined) throw new UnauthorizedError();
  return userId;
}

// isAdmin viene del rol de la sesion, nunca del cuerpo.
function requireActor(req: Request): InventoryCountActor {
  return { userId: requireUserId(req), isAdmin: req.user?.roleName === "admin" };
}

// "Inicio de Inventario": crea la toma o, si el auditor ya tiene una abierta,
// la devuelve para retomarla (resumed).
export async function start(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof startInventoryCountSchema>;
    const { count, resumed } = await inventoryCountService.startInventoryCount({ ...body, createdBy: requireUserId(req) });
    sendOk(
      res,
      { ...count.toJSON(), resumed },
      resumed ? "Ya tiene una toma abierta, se retoma" : "Toma de inventario iniciada exitosamente",
      resumed ? 200 : 201,
    );
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id", "desc", {
      allowedSortBy: ["id", "number", "name", "status", "startedAt", "closedAt"],
      maxLimit: 500,
    });
    const { items, total } = await inventoryCountService.listInventoryCounts(params);
    sendList(res, items, buildPaginationMeta(params, total), "Tomas de inventario obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseId(req.params.id, "Id de toma");
    const count = await inventoryCountService.getInventoryCountByIdOrThrow(id);
    const totals = await inventoryCountService.getInventoryCountLineTotals(id);
    sendOk(res, { ...count.toJSON(), ...totals }, "Toma de inventario obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

// Validacion del colaborador de la pantalla de captura: RUT EXACTO de un usuario activo, detras del
// permiso de esta pantalla para no exigirle asset-movements:create al auditor. Va por POST (el RUT no
// queda en la URL ni en los logs de NGINX) y devuelve solo id y nombre: ya no hay busqueda parcial que
// permita enumerar personas ni se devuelve el resto de los datos personales.
export const findHolderSchema = z.object({
  documentId: z.string().trim().min(3).max(20),
});

export async function findHolder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { documentId } = req.body as z.infer<typeof findHolderSchema>;
    const user = await findActiveUserByDocumentId(documentId);
    // null es un resultado valido: no hay usuario activo con ese RUT.
    sendOk(res, user, user ? "Usuario encontrado" : "No existe un usuario activo con ese RUT");
  } catch (err) {
    next(err);
  }
}

export async function lookup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const by = lookupBySchema.safeParse(req.query.by);
    const value = typeof req.query.value === "string" ? req.query.value : "";
    if (!by.success) throw new BadRequestError("Debe indicar by=TAG o by=SERIAL como query param");
    if (!value.trim()) throw new BadRequestError("Debe indicar value como query param");
    if (value.length > MAX_LOOKUP_VALUE_LENGTH) throw new BadRequestError("El valor a buscar es demasiado largo");
    const result = await inventoryCountService.lookupAsset(parseId(req.params.id, "Id de toma"), by.data, value, requireActor(req));
    // null es un resultado valido: no existe y se generara una etiqueta nueva.
    sendOk(res, result, result ? "Activo encontrado" : "El equipo no existe en el sistema");
  } catch (err) {
    next(err);
  }
}

// Lineas, informe y etiquetas de una toma ABIERTA: solo el auditor o un admin (traen RUT y lo que se esta
// ingresando). Una toma cerrada la lee quien tenga inventory-counts:read.
async function assertCanReadCount(req: Request, countId: number): Promise<void> {
  inventoryCountService.assertCanReadOpenCount(await inventoryCountService.getInventoryCountByIdOrThrow(countId), requireActor(req));
}

export async function listLines(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id", "asc", {
      allowedSortBy: ["id", "createdAt"],
      maxLimit: 1000,
    });
    const countId = parseId(req.params.id, "Id de toma");
    await assertCanReadCount(req, countId);
    const { items, total } = await inventoryCountService.listInventoryLines(countId, params);
    sendList(res, items, buildPaginationMeta(params, total), "Equipos de la toma obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function addLine(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof addInventoryLineSchema>;
    const line = await inventoryCountService.addInventoryLine(
      parseId(req.params.id, "Id de toma"),
      { ...body, createdBy: requireUserId(req) },
      requireActor(req),
    );
    sendOk(res, line, "Equipo ingresado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function updateLine(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateInventoryLineSchema>;
    const line = await inventoryCountService.updateInventoryLine(
      parseId(req.params.id, "Id de toma"),
      parseId(req.params.lineId, "Id de linea"),
      body,
      requireActor(req),
    );
    sendOk(res, line, "Equipo actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function deleteLine(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await inventoryCountService.deleteInventoryLine(
      parseId(req.params.id, "Id de toma"),
      parseId(req.params.lineId, "Id de linea"),
      requireActor(req),
    );
    sendOk(res, null, "Equipo quitado de la toma");
  } catch (err) {
    next(err);
  }
}

// "Fin Inventario": cierra la toma y devuelve los ids de los activos creados,
// para que el front ofrezca imprimir sus etiquetas.
export async function close(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { count, createdAssetIds } = await inventoryCountService.closeInventoryCount(
      parseId(req.params.id, "Id de toma"),
      requireActor(req),
    );
    sendOk(res, { ...count.toJSON(), createdAssetIds }, "Toma de inventario cerrada exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function report(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const countId = parseId(req.params.id, "Id de toma");
    await assertCanReadCount(req, countId);
    const { count, auditor, summary, lines, missingAssets } = await inventoryCountService.getInventoryCountReport(countId);
    sendOk(res, { count, auditor, summary, lines, missingAssets }, "Reporte de toma obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

// PDF al vuelo, mismo criterio que downloadHandover en assetMovement.controller.ts.
export async function downloadReportPdf(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const countId = parseId(req.params.id, "Id de toma");
    await assertCanReadCount(req, countId);
    const { count, auditor, summary, lines, missingAssets } = await inventoryCountService.getInventoryCountReport(countId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="inventario-${count.number}.pdf"`);
    const doc = renderInventoryCountReportPdf({
      number: count.number,
      name: count.name,
      status: count.status,
      startedAt: count.startedAt,
      closedAt: count.closedAt,
      auditor,
      summary,
      lines,
      missingAssets,
    });
    doc.pipe(res);
  } catch (err) {
    next(err);
  }
}

// ZPL de SOLO los activos que creo esta toma, servido como etiquetas.txt (el
// archivo que se manda a la impresora Zebra; la impresion directa por WebUSB la
// hace el navegador con este mismo texto). Lo cubre inventory-counts:read para
// que el auditor no necesite assets:read.
export async function downloadLabels(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsedConfig = labelConfigQuerySchema.safeParse(req.query);
    if (!parsedConfig.success) {
      throw new BadRequestError("Configuracion de etiqueta invalida", parsedConfig.error.flatten());
    }
    const config: AssetLabelConfig = { ...ASSET_LABEL_DEFAULT_CONFIG, ...parsedConfig.data };
    const countId = parseId(req.params.id, "Id de toma");
    await assertCanReadCount(req, countId);
    const items = await inventoryCountService.getCreatedAssetLabelData(countId);
    if (items.length === 0) throw new BadRequestError("La toma no creo activos nuevos, no hay etiquetas que imprimir");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="etiquetas.txt"`);
    res.send(renderAssetLabelsZpl(items, config));
  } catch (err) {
    next(err);
  }
}
