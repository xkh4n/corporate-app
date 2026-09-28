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
    // DEVALUATED, MOVE_TO_RETURNED y RETURNED no estan a proposito: DEVALUATED
    // solo lo crea la toma de inventario (baja reactivada, valor 0) y los otros
    // dos solo el flujo de devoluciones con guia (assetReturn.service.ts). No
    // deben poder dispararse desde la API generica.
    // DECOMMISSIONED tampoco (plan 012): la baja pasa por POST /decommission, que
    // exige su propio permiso, motivo y clasificacion contable.
    movementType: z.enum(["ASSIGNED", "REASSIGNED", "SUPPORT"]),
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

// Reasignar (plan 011): nuevo usuario, nuevo centro de costo o ambos, mas los
// datos del acta (se genera una nueva).
export const reassignAssetSchema = z
  .object({
    assetId: z.number().int().positive(),
    userId: z.number().int().positive().optional(),
    costCenterId: z.number().int().positive().optional(),
    notes: z.string().max(200).optional(),
  })
  .merge(handoverFieldsSchema)
  .refine((data) => data.userId !== undefined || data.costCenterId !== undefined, {
    message: "Indique un nuevo usuario, un nuevo centro de costo o ambos",
  });

// Dar de baja (plan 012): motivo de la lista; el detalle es obligatorio con OTHER.
export const decommissionAssetSchema = z
  .object({
    // multipart (plan 013: va con la foto): los campos llegan como texto.
    assetId: z.coerce.number().int().positive(),
    reason: z.enum(["OBSOLESCENCE", "IRREPARABLE_DAMAGE", "THEFT_LOSS", "OTHER"]),
    detail: z.string().trim().max(200).optional(),
  })
  .refine((data) => data.reason !== "OTHER" || Boolean(data.detail), {
    message: "Indique el detalle del motivo de la baja",
    path: ["detail"],
  });

const assignmentFiltersSchema = z.object({
  costCenterId: z.coerce.number().int().positive().optional(),
  categoryId: z.string().max(24).optional(),
  user: z.string().max(100).optional(),
  serial: z.string().max(100).optional(),
});

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

export async function reassign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof reassignAssetSchema>;
    const movement = await assetMovementService.reassignAsset({ ...body, createdBy: req.user?.userId });
    sendOk(res, movement, "Activo reasignado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function current(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const assetId = Number(req.params.assetId);
    if (!Number.isInteger(assetId) || assetId <= 0) throw new BadRequestError("assetId invalido");
    const assignment = await assetMovementService.getCurrentAssignment(assetId);
    sendOk(res, assignment, "Asignacion vigente obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function listAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = assignmentFiltersSchema.safeParse(req.query);
    if (!filters.success) throw new BadRequestError("Filtros de asignaciones invalidos");
    const params = parsePaginationParams({ ...req.query }, "tag", "asc");
    const { items, total } = await assetMovementService.listAssignments(params, filters.data);
    sendList(res, items, buildPaginationMeta(params, total), "Asignaciones obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function decommissionCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const assetId = Number(req.params.assetId);
    if (!Number.isInteger(assetId) || assetId <= 0) throw new BadRequestError("assetId invalido");
    const check = await assetMovementService.getDecommissionCheck(assetId);
    sendOk(res, check, "Revision de baja obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function decommission(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof decommissionAssetSchema>;
    if (!req.file) throw new BadRequestError("Adjunte la foto del activo (JPEG o PNG)");
    const movement = await assetMovementService.decommissionAsset({
      ...body,
      photo: req.file,
      createdBy: req.user?.userId,
    });
    sendOk(res, movement, "Activo dado de baja: queda pendiente de baja contable", 201);
  } catch (err) {
    next(err);
  }
}

// Inline (se muestra en <img>), con el tipo guardado -ya verificado por magic bytes al subir- y
// nosniff para que el navegador no lo reinterprete. Mismo criterio que las fotos de Baja Contable.
export function sendInlinePhoto(
  res: Response,
  next: NextFunction,
  file: { filePath: string; mimeType: string },
): void {
  res.sendFile(
    file.filePath,
    {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    },
    (err) => {
      if (err) next(err);
    },
  );
}

export async function decommissionPhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const assetId = Number(req.params.assetId);
    if (!Number.isInteger(assetId) || assetId <= 0) throw new BadRequestError("Id de activo invalido");
    sendInlinePhoto(res, next, await assetMovementService.getLatestDecommissionPhotoFile(assetId));
  } catch (err) {
    next(err);
  }
}
