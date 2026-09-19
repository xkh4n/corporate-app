import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as assetMovementService from "../services/postgres/assetMovement.service";
import { listAssignableUsers } from "../services/mssql/user.service";
import { renderAssetHandoverPdf } from "../library/pdf/assetHandoverPdf";
import { BadRequestError } from "../library/errors";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

// MAC en formato AA:BB:CC:DD:EE:FF (mismo formato que produce el helper de
// formateo en vivo del frontend, ver lib/macAddress.ts) -opcional en ambos
// schemas, el acta la muestra en blanco si no viene.
const MAC_ADDRESS_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
// storageCapacity/ramCapacity: opciones fijas de Almacenamiento/Memoria RAM
// del acta de entrega.
const handoverFieldsSchema = z.object({
  supervisorName: z.string().max(150).optional(),
  macAddress: z.string().regex(MAC_ADDRESS_REGEX, "Formato de MAC invalido").optional(),
  storageCapacity: z.enum(["512 GB", "1 TB"]).optional(),
  ramCapacity: z.enum(["8 GB", "16 GB", "32 GB"]).optional(),
  hasBag: z.boolean().optional(),
  hasLock: z.boolean().optional(),
  hasCharger: z.boolean().optional(),
});

export const createAssetMovementSchema = z
  .object({
    assetId: z.number().int().positive(),
    movementType: z.enum(["ASSIGNED", "REASSIGNED", "SUPPORT", "DECOMMISSIONED"]),
    userIds: z.array(z.number().int().positive()).optional(),
    notes: z.string().max(255).optional(),
  })
  .merge(handoverFieldsSchema);

export const assignAssetSchema = z
  .object({
    assetId: z.number().int().positive(),
    userId: z.number().int().positive(),
    notes: z.string().max(255).optional(),
  })
  .merge(handoverFieldsSchema);

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.query.assetId) throw new BadRequestError("Debe indicar assetId como query param");
    const params = parsePaginationParams({ ...req.query, ...req.body }, "movementDate", "desc");
    const { items, total } = await assetMovementService.listMovementsByAsset(Number(req.query.assetId), params);
    sendList(res, items, buildPaginationMeta(params, total), "Movimientos de activo obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createAssetMovementSchema>;
    const movement = await assetMovementService.createAssetMovement({ ...body, createdBy: req.user?.userId });
    sendOk(res, movement, "Movimiento de activo creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

// Picker de empleado en AssignAsset.tsx -busqueda acotada por RUT o nombre
// (ver listAssignableUsers), sin exponer el listado completo de usuarios.
export async function listAssignable(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : "";
    const users = await listAssignableUsers(search);
    sendOk(res, users, "Usuarios asignables obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function assign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof assignAssetSchema>;
    const movement = await assetMovementService.assignAssetToUser({ ...body, createdBy: req.user?.userId });
    sendOk(res, movement, "Activo asignado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

// PDF descargable, mismo criterio que downloadQuoteDocument en
// purchaseRequest.controller.ts: no depende de nada con salida a internet,
// corre entero dentro de este contenedor.
export async function downloadHandover(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await assetMovementService.getAssetHandoverData(Number(req.params.id));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="acta-${data.assetTag}.pdf"`);
    const doc = renderAssetHandoverPdf(data);
    doc.pipe(res);
  } catch (err) {
    next(err);
  }
}
