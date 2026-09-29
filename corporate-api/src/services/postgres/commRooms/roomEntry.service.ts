import { QueryTypes } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { ConflictError, NotFoundError, isUniqueConstraintError } from "../../../library/errors";
import type { PaginationParams } from "../../../library/pagination";
import { getOffset } from "../../../library/pagination";
import { normalizeRut } from "../../../library/rut";
import type { RoomAccessType } from "../../../library/serviceDesk/ticketRules";
import { getUserDirectory } from "../../mssql/user.service";
import { addRoomAccessTicketEvent, VALID_NOW } from "./roomAccess.service";

// Ingresos fisicos a una sala (plan 016): quien custodia la sala registra la entrada y la salida de
// una persona con acceso vigente. Responde "quien ingreso fisicamente".

export interface RoomEntry {
  id: number;
  grantId: number;
  roomId: number;
  roomName: string;
  costCenterName: string;
  beneficiaryName: string;
  beneficiaryDocumentId: string;
  beneficiaryCompany: string | null;
  accessType: RoomAccessType;
  grantStatus: string;
  ticketNumber: string;
  checkedInAt: Date;
  checkedInBy: number;
  checkedInByName: string | null;
  checkedOutAt: Date | null;
  checkedOutBy: number | null;
  checkedOutByName: string | null;
  notes: string | null;
}

type EntryRow = Omit<RoomEntry, "checkedInByName" | "checkedOutByName">;

const ENTRY_SELECT = `
  SELECT e.id, e.grant_id AS "grantId", e.room_id AS "roomId", r.name AS "roomName", cc.name AS "costCenterName",
         g.beneficiary_name AS "beneficiaryName", g.beneficiary_document_id AS "beneficiaryDocumentId",
         g.beneficiary_company AS "beneficiaryCompany", g.access_type AS "accessType", g.status AS "grantStatus",
         t.number AS "ticketNumber", e.checked_in_at AS "checkedInAt", e.checked_in_by AS "checkedInBy",
         e.checked_out_at AS "checkedOutAt", e.checked_out_by AS "checkedOutBy", e.notes
    FROM comm_room_entries e
    JOIN comm_room_access_grants g ON g.id = e.grant_id
    JOIN service_tickets t ON t.id = g.ticket_id
    JOIN comm_rooms r ON r.id = e.room_id
    JOIN cost_centers cc ON cc.id = r.cost_center_id`;

async function withEntryNames(rows: EntryRow[]): Promise<RoomEntry[]> {
  const directory = await getUserDirectory(rows.flatMap((row) => [row.checkedInBy, row.checkedOutBy ?? 0]));
  const nameOf = (id: number | null) => (id ? (directory.get(id)?.fullName ?? `Usuario ${id}`) : null);
  return rows.map((row) => ({ ...row, checkedInByName: nameOf(row.checkedInBy), checkedOutByName: nameOf(row.checkedOutBy) }));
}

async function getEntryOrThrow(id: number): Promise<RoomEntry> {
  const rows = await postgres.query<EntryRow>(`${ENTRY_SELECT} WHERE e.id = :id`, { replacements: { id }, type: QueryTypes.SELECT });
  if (rows.length === 0) throw new NotFoundError(`El ingreso ${id} no existe`);
  return (await withEntryNames(rows))[0]!;
}

export async function checkIn(input: { roomId: number; documentId: string; notes?: string | null }, userId: number): Promise<RoomEntry> {
  const documentId = normalizeRut(input.documentId);
  let entryId: number;
  try {
    entryId = await postgres.transaction(async (transaction) => {
      const [room] = await postgres.query<{ isActive: boolean }>(`SELECT is_active AS "isActive" FROM comm_rooms WHERE id = :roomId`, {
        replacements: { roomId: input.roomId },
        type: QueryTypes.SELECT,
        transaction,
      });
      if (!room) throw new NotFoundError("La sala no existe");
      if (!room.isActive) throw new ConflictError("La sala esta desactivada");
      // Mismo mensaje si no hay acceso o no esta vigente: no se revela que accesos existen.
      const grants = await postgres.query<{ id: number; accessType: RoomAccessType; ticketId: number }>(
        `SELECT id, access_type AS "accessType", ticket_id AS "ticketId" FROM comm_room_access_grants
          WHERE room_id = :roomId AND beneficiary_document_id = :documentId AND ${VALID_NOW}
          ORDER BY (access_type = 'SINGLE_USE'), id FOR UPDATE`,
        { replacements: { roomId: input.roomId, documentId }, type: QueryTypes.SELECT, transaction },
      );
      if (grants.length === 0) throw new ConflictError("La persona no tiene un acceso vigente a esta sala");
      const grantIds = grants.map((grant) => grant.id);
      const [inside] = await postgres.query(
        `SELECT 1 FROM comm_room_entries WHERE grant_id IN (:grantIds) AND checked_out_at IS NULL LIMIT 1`,
        { replacements: { grantIds }, type: QueryTypes.SELECT, transaction },
      );
      if (inside) throw new ConflictError("La persona ya está registrada dentro de la sala: registre primero su salida");
      // Un acceso de unica vez no se reutiliza: se prefiere uno temporal o permanente (ORDER BY de arriba).
      let chosen: (typeof grants)[number] | undefined;
      for (const grant of grants) {
        if (grant.accessType !== "SINGLE_USE") {
          chosen = grant;
          break;
        }
        const [used] = await postgres.query(`SELECT 1 FROM comm_room_entries WHERE grant_id = :id LIMIT 1`, {
          replacements: { id: grant.id },
          type: QueryTypes.SELECT,
          transaction,
        });
        if (!used) {
          chosen = grant;
          break;
        }
      }
      if (!chosen) throw new ConflictError("El acceso de única vez ya fue utilizado");
      const [row] = await postgres.query<{ id: number }>(
        `INSERT INTO comm_room_entries (grant_id, room_id, checked_in_by, notes) VALUES (:grantId, :roomId, :userId, :notes) RETURNING id`,
        {
          replacements: { grantId: chosen.id, roomId: input.roomId, userId, notes: input.notes?.trim() || null },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      return row!.id;
    });
  } catch (err) {
    // Dos registros simultaneos del mismo acceso: el indice de ingreso abierto deja pasar solo uno.
    if (isUniqueConstraintError(err)) throw new ConflictError("La persona ya está registrada dentro de la sala");
    throw err;
  }
  return getEntryOrThrow(entryId);
}

export async function checkOut(id: number, userId: number): Promise<RoomEntry> {
  await postgres.transaction(async (transaction) => {
    const [entry] = await postgres.query<{ grantId: number; checkedOutAt: Date | null }>(
      `SELECT grant_id AS "grantId", checked_out_at AS "checkedOutAt" FROM comm_room_entries WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction },
    );
    if (!entry) throw new NotFoundError(`El ingreso ${id} no existe`);
    if (entry.checkedOutAt) throw new ConflictError("La salida ya fue registrada");
    // La salida siempre se puede registrar, aunque el acceso ya no este vigente.
    await postgres.query(`UPDATE comm_room_entries SET checked_out_at = now(), checked_out_by = :userId WHERE id = :id`, {
      replacements: { id, userId },
      transaction,
    });
    // Unica vez: con la salida el acceso queda usado.
    const [expired] = await postgres.query<{ ticketId: number }>(
      `UPDATE comm_room_access_grants SET status = 'EXPIRED', expired_at = now()
        WHERE id = :grantId AND access_type = 'SINGLE_USE' AND status = 'ACTIVE'
       RETURNING ticket_id AS "ticketId"`,
      { replacements: { grantId: entry.grantId }, type: QueryTypes.SELECT, transaction },
    );
    if (expired) {
      await addRoomAccessTicketEvent(transaction, expired.ticketId, "ROOM_ACCESS_EXPIRED", userId, "Acceso de única vez utilizado", {
        grantId: entry.grantId,
      });
    }
  });
  return getEntryOrThrow(id);
}

export interface EntryFilters {
  grantId?: number;
  roomId?: number;
  open?: boolean;
  documentId?: string;
  from?: Date;
  to?: Date;
}

export async function listEntries(params: PaginationParams, filters: EntryFilters): Promise<{ items: RoomEntry[]; total: number }> {
  const conditions: string[] = [];
  const replacements: Record<string, unknown> = {};
  if (filters.grantId) {
    conditions.push("e.grant_id = :grantId");
    replacements.grantId = filters.grantId;
  }
  if (filters.roomId) {
    conditions.push("e.room_id = :roomId");
    replacements.roomId = filters.roomId;
  }
  if (filters.open) conditions.push("e.checked_out_at IS NULL");
  if (filters.documentId) {
    conditions.push("g.beneficiary_document_id = :documentId");
    replacements.documentId = normalizeRut(filters.documentId);
  }
  if (filters.from) {
    conditions.push("e.checked_in_at >= :from");
    replacements.from = filters.from;
  }
  if (filters.to) {
    conditions.push("e.checked_in_at < :to");
    replacements.to = filters.to;
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const [count] = await postgres.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM comm_room_entries e JOIN comm_room_access_grants g ON g.id = e.grant_id ${where}`,
    { replacements, type: QueryTypes.SELECT },
  );
  const rows = await postgres.query<EntryRow>(
    `${ENTRY_SELECT} ${where} ORDER BY e.checked_in_at ${params.sortOrder === "asc" ? "ASC" : "DESC"}, e.id DESC LIMIT :limit OFFSET :offset`,
    { replacements: { ...replacements, limit: params.limit, offset: getOffset(params) }, type: QueryTypes.SELECT },
  );
  return { items: await withEntryNames(rows), total: count?.total ?? 0 };
}
