import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as writeOffService from "../services/postgres/assetWriteOff.service";
import { BadRequestError, UnauthorizedError } from "../library/errors";
import { buildPaginationMeta, parsePaginationParams } from "../library/pagination";
import { sendList, sendNoContent, sendOk } from "../library/response";

// Baja contable de activos (plan 008).
const ASSET_IDS = z
  .array(z.number().int().positive())
  .min(1)
  .max(writeOffService.MAX_ASSETS_PER_WRITE_OFF);
const DATE = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Formato esperado: AAAA-MM-DD");

export const createWriteOffSchema = z.object({ assetIds: ASSET_IDS }).strict();

export const updateWriteOffSchema = z
  .object({
    writeOffDate: DATE.optional(),
    reason: z.string().trim().min(3).max(255).optional(),
    notary: z.string().trim().max(120).nullable().optional(),
    certificateNumber: z.string().trim().max(60).nullable().optional(),
    assetIds: ASSET_IDS.optional(),
  })
  .strict();

function requireUserId(req: Request): number {
  const userId = req.user?.userId;
  if (userId === undefined) throw new UnauthorizedError();
  return userId;
}

function parseId(value: unknown, label: string): number {
  const id = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError(`${label} invalido`);
  return id;
}

const writeOffId = (req: Request) => parseId(req.params.id, "Id de baja");

export async function listEligible(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query }, "id", "asc", { maxLimit: 200 });
    const { items, total } = await writeOffService.listEligible(params);
    sendList(res, items, buildPaginationMeta(params, total), "Activos elegibles para la baja contable obtenidos");
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query }, "id", "desc", { maxLimit: 200 });
    const [rawStatus] = params.status ?? [];
    const status = rawStatus === "DRAFT" || rawStatus === "CONFIRMED" ? rawStatus : undefined;
    const { items, total } = await writeOffService.listWriteOffs(params, status);
    sendList(res, items, buildPaginationMeta(params, total), "Bajas contables obtenidas");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendOk(res, await writeOffService.getWriteOffOrThrow(writeOffId(req)), "Baja contable obtenida");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { assetIds } = req.body as z.infer<typeof createWriteOffSchema>;
    sendOk(res, await writeOffService.createWriteOff(assetIds, requireUserId(req)), "Borrador de baja creado", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateWriteOffSchema>;
    sendOk(res, await writeOffService.updateWriteOff(writeOffId(req), body), "Borrador de baja actualizado");
  } catch (err) {
    next(err);
  }
}

export async function discard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await writeOffService.discardWriteOff(writeOffId(req));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

// Van ANTES de uploadSingle en la ruta (ver assertUploadAllowed).
export async function precheckCertificateUpload(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    await writeOffService.assertUploadAllowed(writeOffId(req));
    next();
  } catch (err) {
    next(err);
  }
}

export async function precheckPhotoUpload(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    await writeOffService.assertUploadAllowed(writeOffId(req), parseId(req.params.assetId, "Id de activo"));
    next();
  } catch (err) {
    next(err);
  }
}

export async function uploadCertificate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new BadRequestError("Debe adjuntar un archivo (campo 'file')");
    sendOk(res, await writeOffService.attachCertificate(writeOffId(req), req.file), "Certificado notarial adjuntado", 201);
  } catch (err) {
    next(err);
  }
}

// Solo como descarga (attachment), y es la reescritura de qpdf, sin contenido activo.
export async function downloadCertificate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { filePath, downloadName } = await writeOffService.getCertificateFile(writeOffId(req));
    res.sendFile(
      filePath,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${downloadName}"`,
          "Cache-Control": "private, no-store",
        },
      },
      (err) => {
        if (err) next(err);
      },
    );
  } catch (err) {
    next(err);
  }
}

export async function uploadPhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new BadRequestError("Debe adjuntar un archivo (campo 'file')");
    const photo = await writeOffService.addPhoto(
      writeOffId(req),
      parseId(req.params.assetId, "Id de activo"),
      req.file,
      requireUserId(req),
    );
    sendOk(res, photo, "Foto agregada", 201);
  } catch (err) {
    next(err);
  }
}

// Inline (se muestra en <img>), con el tipo guardado -ya verificado por magic
// bytes al subir- y nosniff para que el navegador no lo reinterprete.
export async function getPhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { filePath, mimeType } = await writeOffService.getPhotoFile(
      writeOffId(req),
      parseId(req.params.photoId, "Id de foto"),
    );
    res.sendFile(
      filePath,
      {
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": "inline",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      },
      (err) => {
        if (err) next(err);
      },
    );
  } catch (err) {
    next(err);
  }
}

export async function removePhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await writeOffService.removePhoto(writeOffId(req), parseId(req.params.photoId, "Id de foto"));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

export async function confirm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const detail = await writeOffService.confirmWriteOff(writeOffId(req), requireUserId(req));
    sendOk(res, detail, `Baja contable ${detail.id} confirmada`);
  } catch (err) {
    next(err);
  }
}
