import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { BadRequestError, UnauthorizedError } from "../library/errors";
import type { PermissionAction } from "../models/postgres/permission.model";
import { hasPermission } from "../services/postgres/permission.service";

// Utilidades comunes de los controladores del Service Desk (plan 009).

export function requireUserId(req: Request): number {
  const userId = req.user?.userId;
  if (userId === undefined) throw new UnauthorizedError();
  return userId;
}

// Quien actua en el Service Desk. El admin (bypass de RBAC) y el rol con
// service-tickets:all_view ven todos los tickets (ticketScope.ts).
export function actorOf(req: Request): { userId: number; isAdmin: boolean; roleId?: number } {
  return { userId: requireUserId(req), isAdmin: req.user?.roleName === "admin", roleId: req.user?.roleId };
}

// Permiso adicional evaluado dentro del controlador (mismo criterio que authorize()).
export async function actorCan(req: Request, resource: string, action: PermissionAction): Promise<boolean> {
  if (req.user?.roleName === "admin") return true;
  return req.user ? hasPermission(req.user.roleId, resource, action) : false;
}

export function parseId(value: unknown, label: string): number {
  const id = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError(`${label} invalido`);
  return id;
}

export function optionalQueryId(value: unknown, label: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  return parseId(value, label);
}

export function queryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Adjunto: inline solo para imagenes y PDF (con nosniff); el resto como descarga.
export function sendStoredFile(
  res: Response,
  next: NextFunction,
  file: { filePath: string; mimeType: string; downloadName: string },
): void {
  const inline = file.mimeType.startsWith("image/") || file.mimeType === "application/pdf";
  const safeName = file.downloadName.replace(/["\\\r\n]/g, "_");
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  res.sendFile(
    file.filePath,
    {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    },
    (err) => {
      if (err) next(err);
    },
  );
}

export const TEXT = (max: number) => z.string().trim().min(1).max(max);
export const LEVEL = z.number().int().min(1).max(3);
export const ID = z.number().int().positive();
