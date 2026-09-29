import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { BadRequestError } from "../library/errors";
import { buildPaginationMeta, parsePaginationParams } from "../library/pagination";
import { sendList, sendOk } from "../library/response";
import { ROOM_ACCESS_TYPES, type RoomAccessType } from "../library/serviceDesk/ticketRules";
import * as roomService from "../services/postgres/commRooms/commRoom.service";
import * as accessService from "../services/postgres/commRooms/roomAccess.service";
import * as entryService from "../services/postgres/commRooms/roomEntry.service";
import { optionalQueryId, parseId, queryString, requireUserId, TEXT, ID } from "./serviceDesk.shared";

// Acceso a salas de comunicaciones (plan 016): salas, registros de acceso, ingresos y reportes.
// El acceso se pide y se aprueba por ticket (Service Desk); aca no se crea ningun acceso.

export const roomSchema = z
  .object({
    name: TEXT(120),
    costCenterId: ID,
    address: TEXT(255),
    isActive: z.boolean().optional(),
  })
  .strict();

export const settingsSchema = z.object({ temporaryMaxActiveDays: z.number().int().min(1).max(3650) }).strict();
export const revokeSchema = z.object({ reason: TEXT(1000) }).strict();
export const checkInSchema = z
  .object({ roomId: ID, documentId: z.string().trim().min(3).max(20), notes: z.string().trim().max(500).optional() })
  .strict();

function optionalBool(value: unknown): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function optionalDate(value: unknown, label: string): Date | undefined {
  const text = queryString(value);
  if (!text) return undefined;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new BadRequestError(`${label} invalida`);
  return date;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  const text = queryString(value);
  if (!text) return undefined;
  if (!allowed.includes(text as T)) throw new BadRequestError(`${label} invalido`);
  return text as T;
}

// ---- Salas ------------------------------------------------------------------
export async function listRooms(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query }, "name", "asc", {
      maxLimit: 200,
      allowedSortBy: roomService.COMM_ROOM_SORT_FIELDS,
    });
    const { items, total } = await roomService.listRooms(params, {
      costCenterId: optionalQueryId(req.query.costCenterId, "Centro de costo"),
      isActive: optionalBool(req.query.isActive),
    });
    sendList(res, items, buildPaginationMeta(params, total), "Salas obtenidas");
  } catch (err) {
    next(err);
  }
}

export async function getRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await roomService.getRoomOrThrow(parseId(req.params.id, "Id de sala")), "Sala obtenida");
  } catch (err) {
    next(err);
  }
}

export async function createRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await roomService.createRoom(req.body as z.infer<typeof roomSchema>, requireUserId(req)), "Sala creada", 201);
  } catch (err) {
    next(err);
  }
}

export async function updateRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const room = await roomService.updateRoom(parseId(req.params.id, "Id de sala"), req.body as z.infer<typeof roomSchema>, requireUserId(req));
    sendOk(res, room, "Sala actualizada");
  } catch (err) {
    next(err);
  }
}

export async function getSettings(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await roomService.getSettings(), "Configuracion obtenida");
  } catch (err) {
    next(err);
  }
}

export async function updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await roomService.updateSettings(req.body as z.infer<typeof settingsSchema>, requireUserId(req)), "Configuracion actualizada");
  } catch (err) {
    next(err);
  }
}

// ---- Registros de acceso -----------------------------------------------------
export async function listAccesses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query }, "id", "desc", {
      maxLimit: 200,
      allowedSortBy: accessService.GRANT_SORT_FIELDS,
    });
    const { items, total } = await accessService.listGrants(params, {
      roomId: optionalQueryId(req.query.roomId, "Sala"),
      costCenterId: optionalQueryId(req.query.costCenterId, "Centro de costo"),
      status: optionalEnum(req.query.status, ["ACTIVE", "EXPIRED", "REVOKED"] as const, "Estado"),
      accessType: optionalEnum<RoomAccessType>(req.query.accessType, ROOM_ACCESS_TYPES, "Tipo de acceso"),
      validNow: optionalBool(req.query.validNow),
      documentId: queryString(req.query.documentId).trim() || undefined,
      ticketNumber: queryString(req.query.ticketNumber).trim() || undefined,
      expiredFrom: optionalDate(req.query.expiredFrom, "Fecha desde"),
      expiredTo: optionalDate(req.query.expiredTo, "Fecha hasta"),
      longTemporary: optionalBool(req.query.longTemporary),
    });
    sendList(res, items, buildPaginationMeta(params, total), "Accesos obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function getAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseId(req.params.id, "Id de acceso");
    const grant = await accessService.getGrantOrThrow(id);
    const entries = await entryService.listEntries(
      parsePaginationParams({ limit: "100" }, "checkedInAt", "desc", { maxLimit: 100, allowedSortBy: ["checkedInAt"] }),
      { grantId: id },
    );
    sendOk(res, { ...grant, entries: entries.items }, "Acceso obtenido");
  } catch (err) {
    next(err);
  }
}

export async function revokeAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { reason } = req.body as z.infer<typeof revokeSchema>;
    sendOk(res, await accessService.revokeGrant(parseId(req.params.id, "Id de acceso"), reason, requireUserId(req)), "Acceso revocado");
  } catch (err) {
    next(err);
  }
}

export async function multiRoomReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const by = optionalEnum(req.query.by, ["room", "costCenter"] as const, "Agrupacion") ?? "costCenter";
    // Acotado a 2..50: un valor no finito (Infinity) llegaba a la consulta y daba 500 (revision plan 016, I1).
    const requested = Number(queryString(req.query.minPlaces));
    const minPlaces = Number.isFinite(requested) ? Math.min(50, Math.max(2, Math.trunc(requested))) : 2;
    sendOk(res, await accessService.listMultiRoomHolders(by, minPlaces), "Personas con acceso a varias salas");
  } catch (err) {
    next(err);
  }
}

// ---- Ingresos ----------------------------------------------------------------
// Salas para Registrar Ingreso: sin la direccion, como el portal (revision plan 016, L).
export async function listEntryRooms(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await roomService.listPortalRooms(), "Salas obtenidas");
  } catch (err) {
    next(err);
  }
}

export async function listEntries(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query }, "checkedInAt", "desc", { maxLimit: 200, allowedSortBy: ["checkedInAt"] });
    const { items, total } = await entryService.listEntries(params, {
      roomId: optionalQueryId(req.query.roomId, "Sala"),
      open: optionalBool(req.query.open),
      documentId: queryString(req.query.documentId).trim() || undefined,
      from: optionalDate(req.query.from, "Fecha desde"),
      to: optionalDate(req.query.to, "Fecha hasta"),
    });
    sendList(res, items, buildPaginationMeta(params, total), "Ingresos obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function checkIn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await entryService.checkIn(req.body as z.infer<typeof checkInSchema>, requireUserId(req)), "Ingreso registrado", 201);
  } catch (err) {
    next(err);
  }
}

export async function checkOut(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await entryService.checkOut(parseId(req.params.id, "Id de ingreso"), requireUserId(req)), "Salida registrada");
  } catch (err) {
    next(err);
  }
}
