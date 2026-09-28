import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { BadRequestError, ConflictError, NotFoundError } from "../../library/errors";
import { currentDate } from "../../library/depreciation";
import {
  deleteFolderIfExists,
  deleteIfExists,
  getAssetWriteOffFolder,
  saveBuffer,
} from "../../library/documentStorage";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { lockAssetRow } from "./asset.service";
import { withProductNames, type AccountingStage, type Classification } from "./assetAccounting.service";
import { ACCUMULATED_SQL } from "./assetDepreciation.service";
import {
  createAssetMovement,
  getDecommissionPhotoFile,
  LATEST_DECOMMISSION_MOVEMENT_SQL,
  listDecommissionPhotos,
  type DecommissionPhoto,
} from "./assetMovement.service";

// Baja contable de activos (plan 008). Solo entran activos ya dados de baja
// operativamente (DECOMMISSIONED: el Kardex ya quedo en cero) y clasificados
// (con fila en asset_accounting). Se arma como borrador -fotos por activo y un
// certificado notarial para todo el lote, cada archivo en su propia request-
// y al confirmar es DEFINITIVA: los activos pasan a WRITTEN_OFF y cada linea
// guarda el valor libro contable de ese momento (la perdida por baja). No
// escribe en el Kardex.
// Plan 013: la foto de cada activo normalmente ya viene de Dar de Baja Activos
// (decommissionPhotos); las fotos del borrador quedan para lo que dio de baja la
// toma de inventario. Al confirmar, cada activo pasa a WRITTEN_OFF («De baja»).

export type WriteOffStatus = "DRAFT" | "CONFIRMED";

export const MAX_ASSETS_PER_WRITE_OFF = 200;
export const MAX_PHOTOS_PER_ASSET = 10;
const CERTIFICATE_FILENAME = "certificado.pdf";
const PHOTO_EXTENSIONS: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png" };

export interface WriteOffSummary {
  id: number;
  status: WriteOffStatus;
  writeOffDate: string | null;
  reason: string | null;
  notary: string | null;
  certificateNumber: string | null;
  hasCertificate: boolean;
  lineCount: number;
  assetCount: number;
  totalBookValue: string;
  createdBy: number;
  createdAt: Date;
  confirmedBy: number | null;
  confirmedAt: Date | null;
}

export interface WriteOffPhoto {
  id: number;
  assetId: number;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface WriteOffLine {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  statusCode: string;
  costCenterName: string | null;
  productName: string | null;
  classification: Classification;
  // Borrador: la etapa y el valor libro actuales. Confirmada: los guardados al confirmar.
  stage: AccountingStage;
  bookValue: string;
  photos: WriteOffPhoto[];
  // Fotos tomadas al dar de baja el activo (plan 013).
  decommissionPhotos: DecommissionPhoto[];
}

export interface WriteOffDetail extends WriteOffSummary {
  lines: WriteOffLine[];
}

export interface EligibleAsset {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  costCenterName: string | null;
  productName: string | null;
  classification: Classification;
  stage: AccountingStage;
  bookValue: string;
}

// Valor libro contable al momento de la baja:
// - capitalizado: costo capitalizado - depreciacion acumulada (cierres vigentes);
// - costo fijado sin capitalizar: el costo capitalizado;
// - gasto: 0 (ya se reconocio como gasto);
// - resto (activo fijo recien clasificado, inventario): el valor del activo.
const BOOK_VALUE_SQL = `
  (CASE
     WHEN aa.stage IN ('CAPITALIZED','DEPRECIATING','FULLY_DEPRECIATED') THEN aa.capitalized_cost - ${ACCUMULATED_SQL}
     WHEN aa.stage = 'COSTED' THEN aa.capitalized_cost
     WHEN aa.classification = 'EXPENSE' THEN 0
     ELSE COALESCE(a.value, 0)
   END)
`;

const ELIGIBLE_FROM = `
  FROM asset_accounting aa
  JOIN assets a ON a.id = aa.asset_id
  JOIN asset_statuses s ON s.id = a.status_id
  LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
 WHERE s.code = 'DECOMMISSIONED' AND aa.stage <> 'WRITTEN_OFF'
`;

const ASSET_COLUMNS = `
  a.id AS "assetId", a.tag, a.serial_number AS "serialNumber", cc.name AS "costCenterName",
  a.product_id AS "productId", aa.classification, aa.stage, (${BOOK_VALUE_SQL})::numeric(18,2)::text AS "bookValue"
`;

const SUMMARY_COLUMNS = `
  w.id, w.status, to_char(w.write_off_date, 'YYYY-MM-DD') AS "writeOffDate", w.reason, w.notary,
  w.certificate_number AS "certificateNumber", (w.certificate_filename IS NOT NULL) AS "hasCertificate",
  (SELECT COUNT(*)::int FROM asset_write_off_lines l WHERE l.write_off_id = w.id) AS "lineCount",
  w.asset_count AS "assetCount", w.total_book_value::text AS "totalBookValue",
  w.created_by AS "createdBy", w.created_at AS "createdAt", w.confirmed_by AS "confirmedBy", w.confirmed_at AS "confirmedAt"
`;

type RawEligible = Omit<EligibleAsset, "productName"> & { productId: string | null };

function searchClause(search: string | undefined): { sql: string; replacements: Record<string, string> } {
  if (!search) return { sql: "", replacements: {} };
  return { sql: " AND (a.tag ILIKE :search OR a.serial_number ILIKE :search)", replacements: { search: `%${search}%` } };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
export async function listEligible(params: PaginationParams): Promise<{ items: EligibleAsset[]; total: number }> {
  const search = searchClause(params.search);
  const [countRow] = await postgres.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total ${ELIGIBLE_FROM}${search.sql}`,
    { replacements: search.replacements, type: QueryTypes.SELECT },
  );
  const rows = await postgres.query<RawEligible>(
    `SELECT ${ASSET_COLUMNS} ${ELIGIBLE_FROM}${search.sql} ORDER BY a.id LIMIT :limit OFFSET :offset`,
    {
      replacements: { ...search.replacements, limit: params.limit, offset: getOffset(params) },
      type: QueryTypes.SELECT,
    },
  );
  return { items: await withProductNames(rows), total: countRow?.total ?? 0 };
}

export async function listWriteOffs(
  params: PaginationParams,
  status?: WriteOffStatus,
): Promise<{ items: WriteOffSummary[]; total: number }> {
  const where = status ? "WHERE w.status = :status" : "";
  const replacements = status ? { status } : {};
  const [countRow] = await postgres.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM asset_write_offs w ${where}`,
    { replacements, type: QueryTypes.SELECT },
  );
  const items = await postgres.query<WriteOffSummary>(
    `SELECT ${SUMMARY_COLUMNS} FROM asset_write_offs w ${where} ORDER BY w.id DESC LIMIT :limit OFFSET :offset`,
    { replacements: { ...replacements, limit: params.limit, offset: getOffset(params) }, type: QueryTypes.SELECT },
  );
  return { items, total: countRow?.total ?? 0 };
}

async function findSummary(id: number, transaction?: Transaction): Promise<WriteOffSummary | null> {
  const [summary] = await postgres.query<WriteOffSummary>(`SELECT ${SUMMARY_COLUMNS} FROM asset_write_offs w WHERE w.id = :id`, {
    replacements: { id },
    type: QueryTypes.SELECT,
    transaction,
  });
  return summary ?? null;
}

export async function getWriteOffOrThrow(id: number, transaction?: Transaction): Promise<WriteOffDetail> {
  const summary = await findSummary(id, transaction);
  if (!summary) throw new NotFoundError(`La baja ${id} no existe`);

  const confirmed = summary.status === "CONFIRMED";
  const rows = await postgres.query<RawEligible & { statusCode: string }>(
    `SELECT a.id AS "assetId", a.tag, a.serial_number AS "serialNumber", cc.name AS "costCenterName",
            a.product_id AS "productId", s.code AS "statusCode", aa.classification,
            ${confirmed ? `l.stage_before` : `aa.stage`} AS stage,
            ${confirmed ? `l.book_value` : `(${BOOK_VALUE_SQL})::numeric(18,2)`}::text AS "bookValue"
       FROM asset_write_off_lines l
       JOIN assets a ON a.id = l.asset_id
       JOIN asset_statuses s ON s.id = a.status_id
       JOIN asset_accounting aa ON aa.asset_id = l.asset_id
       LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
      WHERE l.write_off_id = :id
      ORDER BY a.id`,
    { replacements: { id }, type: QueryTypes.SELECT, transaction },
  );
  const photos = await postgres.query<WriteOffPhoto>(
    `SELECT id, asset_id AS "assetId", mime_type AS "mimeType", size_bytes AS "sizeBytes", created_at AS "createdAt"
       FROM asset_write_off_photos WHERE write_off_id = :id ORDER BY id`,
    { replacements: { id }, type: QueryTypes.SELECT, transaction },
  );
  const decommissionPhotos = await listDecommissionPhotos(
    rows.map((row) => row.assetId),
    transaction,
  );
  const lines = (await withProductNames(rows)).map((line) => ({
    ...line,
    photos: photos.filter((photo) => photo.assetId === line.assetId),
    decommissionPhotos: decommissionPhotos.filter((photo) => photo.assetId === line.assetId),
  }));
  return { ...summary, lines };
}

// ---------------------------------------------------------------------------
// Borrador
// ---------------------------------------------------------------------------
async function lockWriteOff(id: number, transaction: Transaction): Promise<{ status: WriteOffStatus }> {
  const [row] = await postgres.query<{ status: WriteOffStatus }>(
    `SELECT status FROM asset_write_offs WHERE id = :id FOR UPDATE`,
    { replacements: { id }, type: QueryTypes.SELECT, transaction },
  );
  if (!row) throw new NotFoundError(`La baja ${id} no existe`);
  return row;
}

async function lockDraft(id: number, transaction: Transaction): Promise<void> {
  const { status } = await lockWriteOff(id, transaction);
  if (status !== "DRAFT") throw new ConflictError(`La baja ${id} ya esta confirmada: es definitiva y no se modifica`);
}

// Todos los activos deben existir y ser elegibles; si no, 409 con el detalle.
async function assertEligible(assetIds: number[], transaction: Transaction): Promise<void> {
  if (assetIds.length === 0) return;
  const rows = await postgres.query<{ assetId: number }>(
    `SELECT a.id AS "assetId" ${ELIGIBLE_FROM} AND a.id IN (:assetIds)`,
    { replacements: { assetIds }, type: QueryTypes.SELECT, transaction },
  );
  const eligible = new Set(rows.map((row) => row.assetId));
  const rejected = assetIds.filter((id) => !eligible.has(id));
  if (rejected.length > 0) {
    throw new ConflictError(
      "Solo se pueden dar de baja contablemente activos clasificados, dados de baja operativamente y sin baja contable",
      { rejectedAssetIds: rejected },
    );
  }
}

function assertAssetCount(assetIds: number[]): void {
  if (assetIds.length === 0) throw new BadRequestError("La baja debe tener al menos un activo");
  if (assetIds.length > MAX_ASSETS_PER_WRITE_OFF) {
    throw new BadRequestError(`Una baja admite hasta ${MAX_ASSETS_PER_WRITE_OFF} activos`);
  }
}

function assertNotFuture(writeOffDate: string): void {
  if (writeOffDate > currentDate()) throw new BadRequestError("La fecha de baja no puede ser futura");
}

export async function createWriteOff(assetIds: number[], userId: number): Promise<WriteOffDetail> {
  const ids = [...new Set(assetIds)];
  assertAssetCount(ids);
  return postgres.transaction(async (transaction) => {
    await assertEligible(ids, transaction);
    const [created] = await postgres.query<{ id: number }>(
      `INSERT INTO asset_write_offs (created_by) VALUES (:userId) RETURNING id`,
      { replacements: { userId }, type: QueryTypes.SELECT, transaction },
    );
    const id = created!.id;
    await postgres.query(
      `INSERT INTO asset_write_off_lines (write_off_id, asset_id) SELECT :id, unnest(ARRAY[:ids]::int[])`,
      { replacements: { id, ids }, transaction },
    );
    return getWriteOffOrThrow(id, transaction);
  });
}

// Baja por lote (plan 013): un borrador con todos los pendientes que no estan ya en otro
// borrador, hasta MAX_ASSETS_PER_WRITE_OFF. notIncluded: los que quedaron fuera por el tope.
export async function createAllPendingWriteOff(
  userId: number,
): Promise<{ detail: WriteOffDetail; notIncluded: number }> {
  const rows = await postgres.query<{ assetId: number }>(
    `SELECT a.id AS "assetId" ${ELIGIBLE_FROM}
        AND NOT EXISTS (SELECT 1 FROM asset_write_off_lines l JOIN asset_write_offs w ON w.id = l.write_off_id
                         WHERE l.asset_id = a.id AND w.status = 'DRAFT')
      ORDER BY a.id`,
    { type: QueryTypes.SELECT },
  );
  if (rows.length === 0) {
    throw new BadRequestError("No hay activos pendientes de baja contable fuera de otros borradores");
  }
  const ids = rows.slice(0, MAX_ASSETS_PER_WRITE_OFF).map((row) => row.assetId);
  return { detail: await createWriteOff(ids, userId), notIncluded: rows.length - ids.length };
}

export interface WriteOffUpdate {
  writeOffDate?: string;
  reason?: string;
  notary?: string | null;
  certificateNumber?: string | null;
  assetIds?: number[];
}

export async function updateWriteOff(id: number, input: WriteOffUpdate): Promise<WriteOffDetail> {
  if (input.writeOffDate !== undefined) assertNotFuture(input.writeOffDate);
  const removedPhotoFiles: string[] = [];
  const detail = await postgres.transaction(async (transaction) => {
    await lockDraft(id, transaction);

    if (input.assetIds !== undefined) {
      const ids = [...new Set(input.assetIds)];
      assertAssetCount(ids);
      const current = await postgres.query<{ assetId: number }>(
        `SELECT asset_id AS "assetId" FROM asset_write_off_lines WHERE write_off_id = :id`,
        { replacements: { id }, type: QueryTypes.SELECT, transaction },
      );
      const currentIds = new Set(current.map((row) => row.assetId));
      const added = ids.filter((assetId) => !currentIds.has(assetId));
      const removed = [...currentIds].filter((assetId) => !ids.includes(assetId));
      await assertEligible(added, transaction);
      if (removed.length > 0) {
        // Las fotos de las lineas quitadas se borran en cascada; sus archivos, despues del commit.
        const photos = await postgres.query<{ filename: string }>(
          `SELECT filename FROM asset_write_off_photos WHERE write_off_id = :id AND asset_id IN (:removed)`,
          { replacements: { id, removed }, type: QueryTypes.SELECT, transaction },
        );
        removedPhotoFiles.push(...photos.map((photo) => photo.filename));
        await postgres.query(`DELETE FROM asset_write_off_lines WHERE write_off_id = :id AND asset_id IN (:removed)`, {
          replacements: { id, removed },
          transaction,
        });
      }
      if (added.length > 0) {
        await postgres.query(
          `INSERT INTO asset_write_off_lines (write_off_id, asset_id) SELECT :id, unnest(ARRAY[:added]::int[])`,
          { replacements: { id, added }, transaction },
        );
      }
    }

    await postgres.query(
      `UPDATE asset_write_offs
          SET write_off_date = CASE WHEN :setDate THEN CAST(:writeOffDate AS DATE) ELSE write_off_date END,
              reason = CASE WHEN :setReason THEN :reason ELSE reason END,
              notary = CASE WHEN :setNotary THEN :notary ELSE notary END,
              certificate_number = CASE WHEN :setNumber THEN :certificateNumber ELSE certificate_number END,
              updated_at = now()
        WHERE id = :id`,
      {
        replacements: {
          id,
          setDate: input.writeOffDate !== undefined,
          writeOffDate: input.writeOffDate ?? null,
          setReason: input.reason !== undefined,
          reason: input.reason ?? null,
          setNotary: input.notary !== undefined,
          notary: input.notary ?? null,
          setNumber: input.certificateNumber !== undefined,
          certificateNumber: input.certificateNumber ?? null,
        },
        transaction,
      },
    );
    return getWriteOffOrThrow(id, transaction);
  });
  for (const filename of removedPhotoFiles) deleteIfExists(getAssetWriteOffFolder(id), filename);
  return detail;
}

// Descartar un borrador borra sus lineas, fotos (cascada) y la carpeta de archivos.
export async function discardWriteOff(id: number): Promise<void> {
  await postgres.transaction(async (transaction) => {
    await lockDraft(id, transaction);
    await postgres.query(`DELETE FROM asset_write_offs WHERE id = :id`, { replacements: { id }, transaction });
  });
  deleteFolderIfExists(getAssetWriteOffFolder(id));
}

// ---------------------------------------------------------------------------
// Archivos
// ---------------------------------------------------------------------------

// Va ANTES de recibir el archivo (multer + qpdf son caros): el borrador existe,
// sigue en DRAFT y, para una foto, el activo es una linea suya.
export async function assertUploadAllowed(id: number, assetId?: number): Promise<void> {
  const [row] = await postgres.query<{ status: WriteOffStatus; hasLine: boolean }>(
    `SELECT w.status,
            EXISTS (SELECT 1 FROM asset_write_off_lines l WHERE l.write_off_id = w.id AND l.asset_id = :assetId) AS "hasLine"
       FROM asset_write_offs w WHERE w.id = :id`,
    { replacements: { id, assetId: assetId ?? 0 }, type: QueryTypes.SELECT },
  );
  if (!row) throw new NotFoundError(`La baja ${id} no existe`);
  if (row.status !== "DRAFT") throw new ConflictError(`La baja ${id} ya esta confirmada: es definitiva y no se modifica`);
  if (assetId !== undefined && !row.hasLine) throw new NotFoundError(`El activo ${assetId} no es parte de la baja ${id}`);
}

export async function attachCertificate(id: number, file: Express.Multer.File): Promise<WriteOffDetail> {
  if (file.mimetype !== "application/pdf") throw new BadRequestError("El certificado notarial debe ser un archivo PDF");
  return postgres.transaction(async (transaction) => {
    await lockDraft(id, transaction);
    // Mismo nombre siempre: reemplazar el certificado es sobrescribirlo (escritura atomica).
    saveBuffer(getAssetWriteOffFolder(id), CERTIFICATE_FILENAME, file.buffer);
    await postgres.query(
      `UPDATE asset_write_offs SET certificate_filename = :filename, updated_at = now() WHERE id = :id`,
      { replacements: { id, filename: CERTIFICATE_FILENAME }, transaction },
    );
    return getWriteOffOrThrow(id, transaction);
  });
}

export async function addPhoto(
  id: number,
  assetId: number,
  file: Express.Multer.File,
  userId: number,
): Promise<WriteOffPhoto> {
  const extension = PHOTO_EXTENSIONS[file.mimetype];
  if (!extension) throw new BadRequestError("La foto debe ser JPEG o PNG");
  const filename = `foto-${randomUUID()}${extension}`;
  let written = false;
  try {
    return await postgres.transaction(async (transaction) => {
      await lockDraft(id, transaction);
      const [line] = await postgres.query<{ photoCount: number }>(
        `SELECT (SELECT COUNT(*)::int FROM asset_write_off_photos p
                  WHERE p.write_off_id = l.write_off_id AND p.asset_id = l.asset_id) AS "photoCount"
           FROM asset_write_off_lines l WHERE l.write_off_id = :id AND l.asset_id = :assetId`,
        { replacements: { id, assetId }, type: QueryTypes.SELECT, transaction },
      );
      if (!line) throw new NotFoundError(`El activo ${assetId} no es parte de la baja ${id}`);
      if (line.photoCount >= MAX_PHOTOS_PER_ASSET) {
        throw new ConflictError(`Cada activo admite hasta ${MAX_PHOTOS_PER_ASSET} fotos`);
      }
      const [photo] = await postgres.query<WriteOffPhoto>(
        `INSERT INTO asset_write_off_photos (write_off_id, asset_id, filename, mime_type, size_bytes, created_by)
         VALUES (:id, :assetId, :filename, :mimeType, :sizeBytes, :userId)
         RETURNING id, asset_id AS "assetId", mime_type AS "mimeType", size_bytes AS "sizeBytes", created_at AS "createdAt"`,
        {
          replacements: { id, assetId, filename, mimeType: file.mimetype, sizeBytes: file.size, userId },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      saveBuffer(getAssetWriteOffFolder(id), filename, file.buffer);
      written = true;
      return photo!;
    });
  } catch (err) {
    if (written) deleteIfExists(getAssetWriteOffFolder(id), filename);
    throw err;
  }
}

export async function removePhoto(id: number, photoId: number): Promise<void> {
  const filename = await postgres.transaction(async (transaction) => {
    await lockDraft(id, transaction);
    const [photo] = await postgres.query<{ filename: string }>(
      `DELETE FROM asset_write_off_photos WHERE id = :photoId AND write_off_id = :id RETURNING filename`,
      { replacements: { id, photoId }, type: QueryTypes.SELECT, transaction },
    );
    if (!photo) throw new NotFoundError(`La foto ${photoId} no existe en la baja ${id}`);
    return photo.filename;
  });
  deleteIfExists(getAssetWriteOffFolder(id), filename);
}

// Ruta en disco de un archivo de la baja. El nombre viene de la BD (lo genero
// el servidor); aun asi se reduce a basename y se exige que quede dentro de la
// carpeta, por defensa en profundidad.
function resolveStoredFile(id: number, storedName: string, missingMessage: string): string {
  const folder = getAssetWriteOffFolder(id);
  const filePath = path.resolve(folder, path.basename(storedName));
  if (!filePath.startsWith(path.resolve(folder) + path.sep) || !fs.existsSync(filePath)) {
    throw new NotFoundError(missingMessage);
  }
  return filePath;
}

export async function getCertificateFile(id: number): Promise<{ filePath: string; downloadName: string }> {
  const [row] = await postgres.query<{ certificateFilename: string | null }>(
    `SELECT certificate_filename AS "certificateFilename" FROM asset_write_offs WHERE id = :id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  if (!row) throw new NotFoundError(`La baja ${id} no existe`);
  if (!row.certificateFilename) throw new NotFoundError("La baja no tiene certificado notarial adjunto");
  return {
    filePath: resolveStoredFile(id, row.certificateFilename, "El certificado no se encuentra en el almacenamiento"),
    downloadName: `certificado-baja-${id}.pdf`,
  };
}

export async function getPhotoFile(id: number, photoId: number): Promise<{ filePath: string; mimeType: string }> {
  const [row] = await postgres.query<{ filename: string; mimeType: string }>(
    `SELECT filename, mime_type AS "mimeType" FROM asset_write_off_photos WHERE id = :photoId AND write_off_id = :id`,
    { replacements: { id, photoId }, type: QueryTypes.SELECT },
  );
  if (!row) throw new NotFoundError(`La foto ${photoId} no existe en la baja ${id}`);
  return {
    filePath: resolveStoredFile(id, row.filename, "La foto no se encuentra en el almacenamiento"),
    mimeType: row.mimeType,
  };
}

// Foto de la baja operativa de un activo que es linea de esta baja (plan 013).
export async function getLineDecommissionPhotoFile(
  id: number,
  photoId: number,
): Promise<{ filePath: string; mimeType: string }> {
  const [row] = await postgres.query<{ assetId: number }>(
    `SELECT d.asset_id AS "assetId"
       FROM asset_decommission_photos d
       JOIN asset_write_off_lines l ON l.asset_id = d.asset_id AND l.write_off_id = :id
      WHERE d.id = :photoId AND d.movement_id = ${LATEST_DECOMMISSION_MOVEMENT_SQL}`,
    { replacements: { id, photoId }, type: QueryTypes.SELECT },
  );
  if (!row) throw new NotFoundError(`La foto ${photoId} no existe en la baja ${id}`);
  return getDecommissionPhotoFile(photoId, row.assetId);
}

// ---------------------------------------------------------------------------
// Confirmacion (definitiva)
// ---------------------------------------------------------------------------
export async function confirmWriteOff(id: number, userId: number): Promise<WriteOffDetail> {
  return postgres.transaction(async (transaction) => {
    await lockDraft(id, transaction);
    const header = await findSummary(id, transaction);
    if (!header!.writeOffDate || !header!.reason) {
      throw new BadRequestError("Complete la fecha y el motivo de la baja antes de confirmarla");
    }
    if (!header!.hasCertificate) throw new BadRequestError("Adjunte el certificado notarial antes de confirmar la baja");
    assertNotFuture(header!.writeOffDate);

    const lines = await postgres.query<{ assetId: number }>(
      `SELECT asset_id AS "assetId" FROM asset_write_off_lines WHERE write_off_id = :id ORDER BY asset_id`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction },
    );
    const assetIds = lines.map((line) => line.assetId);
    if (assetIds.length === 0) throw new BadRequestError("La baja debe tener al menos un activo");

    // Siempre en el mismo orden (por id): dos confirmaciones con activos en
    // comun se serializan en vez de bloquearse mutuamente.
    for (const assetId of assetIds) await lockAssetRow(assetId, transaction);
    const current = await postgres.query<{
      assetId: number;
      tag: string;
      statusCode: string;
      stage: AccountingStage;
      bookValue: string;
      photoCount: number;
    }>(
      `SELECT a.id AS "assetId", a.tag, s.code AS "statusCode", aa.stage,
              (${BOOK_VALUE_SQL})::numeric(18,2)::text AS "bookValue",
              (SELECT COUNT(*)::int FROM asset_write_off_photos p
                WHERE p.write_off_id = :id AND p.asset_id = a.id)
              + (SELECT COUNT(*)::int FROM asset_decommission_photos d
                  WHERE d.asset_id = a.id AND d.movement_id = ${LATEST_DECOMMISSION_MOVEMENT_SQL}) AS "photoCount"
         FROM asset_accounting aa
         JOIN assets a ON a.id = aa.asset_id
         JOIN asset_statuses s ON s.id = a.status_id
        WHERE aa.asset_id IN (:assetIds)
        ORDER BY aa.asset_id
          FOR UPDATE OF aa`,
      { replacements: { id, assetIds }, type: QueryTypes.SELECT, transaction },
    );

    const notEligible = current.filter((row) => row.statusCode !== "DECOMMISSIONED" || row.stage === "WRITTEN_OFF");
    if (notEligible.length > 0 || current.length !== assetIds.length) {
      throw new ConflictError(
        `Hay activos que ya no se pueden dar de baja (dados de baja en otra baja o reactivados): ${notEligible
          .map((row) => row.tag)
          .join(", ")}. Quitelos del borrador.`,
        { rejectedAssetIds: notEligible.map((row) => row.assetId) },
      );
    }
    const withoutPhoto = current.filter((row) => row.photoCount === 0);
    if (withoutPhoto.length > 0) {
      throw new BadRequestError(
        `Falta al menos una foto de: ${withoutPhoto.map((row) => row.tag).join(", ")}`,
        { assetIdsWithoutPhoto: withoutPhoto.map((row) => row.assetId) },
      );
    }

    let totalCents = 0;
    for (const row of current) {
      totalCents += Math.round(Number(row.bookValue) * 100);
      await postgres.query(
        `UPDATE asset_write_off_lines SET stage_before = :stage, book_value = :bookValue
          WHERE write_off_id = :id AND asset_id = :assetId`,
        { replacements: { id, assetId: row.assetId, stage: row.stage, bookValue: row.bookValue }, transaction },
      );
    }
    await postgres.query(
      `UPDATE asset_accounting SET stage = 'WRITTEN_OFF', write_off_id = :id, updated_at = now()
        WHERE asset_id IN (:assetIds)`,
      { replacements: { id, assetIds }, transaction },
    );
    // Plan 013: el activo pasa de «Pendiente de baja contable» a «De baja» (sin asiento en el
    // Kardex: ya quedo en cero al darlo de baja).
    for (const row of current) {
      await createAssetMovement(
        { assetId: row.assetId, movementType: "WRITTEN_OFF", notes: `Baja contable N° ${id}`, createdBy: userId },
        transaction,
      );
    }
    await postgres.query(
      `UPDATE asset_write_offs
          SET status = 'CONFIRMED', asset_count = :count, total_book_value = :total,
              confirmed_by = :userId, confirmed_at = now(), updated_at = now()
        WHERE id = :id`,
      { replacements: { id, count: current.length, total: (totalCents / 100).toFixed(2), userId }, transaction },
    );
    return getWriteOffOrThrow(id, transaction);
  });
}
