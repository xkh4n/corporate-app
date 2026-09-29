import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { BadRequestError, ConflictError, NotFoundError } from "../../../library/errors";
import type { PaginationParams } from "../../../library/pagination";
import { getOffset } from "../../../library/pagination";
import { normalizeRut } from "../../../library/rut";
import {
  roomAccessPeriodError,
  type RoomAccessType,
  type RoomBeneficiaryKind,
} from "../../../library/serviceDesk/ticketRules";
import { findBeneficiaryByDocumentId } from "../../mssql/person.service";
import { getUserDirectory } from "../../mssql/user.service";
import { getSettings } from "./commRoom.service";

// Solicitudes y registros de acceso a salas de comunicaciones (plan 016). La solicitud nace con el
// ticket (ticket.service.ts) y la aprobacion del ticket crea el grant: estas funciones reciben la
// transaccion del ticket para que todo quede en un mismo commit.

// ---------------------------------------------------------------------------
// Solicitud (al crear el ticket)
// ---------------------------------------------------------------------------
export type RoomBeneficiaryInput =
  | { kind: "INTERNAL"; documentId: string }
  | { kind: "EXTERNAL"; fullName: string; documentId: string; company: string };

export interface RoomAccessInput {
  roomId: number;
  beneficiary: RoomBeneficiaryInput;
  reason: string;
  requestedType: RoomAccessType;
  requestedFrom: string;
  requestedUntil?: string | null;
}

// Beneficiario ya resuelto: un colaborador se busca en el servidor por RUT exacto (nunca se confia
// en un personId del cliente).
export interface ResolvedRoomAccessInput extends Omit<RoomAccessInput, "beneficiary"> {
  beneficiary: { kind: RoomBeneficiaryKind; personId: number | null; name: string; documentId: string; company: string | null };
}

export async function resolveRoomAccessInput(input: RoomAccessInput): Promise<ResolvedRoomAccessInput> {
  const documentId = normalizeRut(input.beneficiary.documentId);
  if (input.beneficiary.kind === "INTERNAL") {
    const person = await findBeneficiaryByDocumentId(documentId);
    if (!person) throw new BadRequestError("No hay un colaborador activo con ese RUT", { field: "beneficiary.documentId" });
    return { ...input, beneficiary: { kind: "INTERNAL", personId: person.personId, name: person.fullName, documentId, company: null } };
  }
  return {
    ...input,
    beneficiary: { kind: "EXTERNAL", personId: null, name: input.beneficiary.fullName.trim(), documentId, company: input.beneficiary.company.trim() },
  };
}

async function assertActiveRoom(roomId: number, transaction: Transaction): Promise<{ name: string }> {
  const [room] = await postgres.query<{ name: string; isActive: boolean }>(
    `SELECT name, is_active AS "isActive" FROM comm_rooms WHERE id = :roomId`,
    { replacements: { roomId }, type: QueryTypes.SELECT, transaction },
  );
  if (!room) throw new BadRequestError("La sala no existe");
  if (!room.isActive) throw new ConflictError(`La sala ${room.name} esta desactivada`);
  return room;
}

export async function insertAccessRequest(ticketId: number, input: ResolvedRoomAccessInput, transaction: Transaction): Promise<{ roomName: string }> {
  const room = await assertActiveRoom(input.roomId, transaction);
  const from = new Date(input.requestedFrom);
  const until = input.requestedUntil ? new Date(input.requestedUntil) : null;
  const periodError = roomAccessPeriodError(input.requestedType, from, until);
  if (periodError) throw new BadRequestError(periodError);
  await postgres.query(
    `INSERT INTO comm_room_access_requests (ticket_id, room_id, beneficiary_kind, beneficiary_person_id, beneficiary_name,
                                            beneficiary_document_id, beneficiary_company, reason, requested_type,
                                            requested_from, requested_until)
     VALUES (:ticketId, :roomId, :kind, :personId, :name, :documentId, :company, :reason, :type, :from, :until)`,
    {
      replacements: {
        ticketId,
        roomId: input.roomId,
        kind: input.beneficiary.kind,
        personId: input.beneficiary.personId,
        name: input.beneficiary.name,
        documentId: input.beneficiary.documentId,
        company: input.beneficiary.company,
        reason: input.reason.trim(),
        type: input.requestedType,
        from,
        until,
      },
      transaction,
    },
  );
  return { roomName: room.name };
}

// ---------------------------------------------------------------------------
// Solicitud vinculada a un ticket
// ---------------------------------------------------------------------------
export type RoomAccessRequestStatus = "REQUESTED" | "VALIDATED" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface RoomAccessRequestRow {
  id: number;
  ticketId: number;
  roomId: number;
  roomName: string;
  roomIsActive: boolean;
  costCenterName: string;
  beneficiaryKind: RoomBeneficiaryKind;
  beneficiaryPersonId: number | null;
  beneficiaryName: string;
  beneficiaryDocumentId: string;
  beneficiaryCompany: string | null;
  reason: string;
  requestedType: RoomAccessType;
  requestedFrom: Date;
  requestedUntil: Date | null;
  status: RoomAccessRequestStatus;
  validatedBy: number | null;
  validatedAt: Date | null;
  validationNotes: string | null;
  accessType: RoomAccessType | null;
  validFrom: Date | null;
  validUntil: Date | null;
  decidedBy: number | null;
  decidedAt: Date | null;
  decisionComment: string | null;
}

const REQUEST_COLUMNS = `
  q.id, q.ticket_id AS "ticketId", q.room_id AS "roomId", r.name AS "roomName", r.is_active AS "roomIsActive",
  cc.name AS "costCenterName", q.beneficiary_kind AS "beneficiaryKind", q.beneficiary_person_id AS "beneficiaryPersonId",
  q.beneficiary_name AS "beneficiaryName", q.beneficiary_document_id AS "beneficiaryDocumentId",
  q.beneficiary_company AS "beneficiaryCompany", q.reason, q.requested_type AS "requestedType",
  q.requested_from AS "requestedFrom", q.requested_until AS "requestedUntil", q.status,
  q.validated_by AS "validatedBy", q.validated_at AS "validatedAt", q.validation_notes AS "validationNotes",
  q.access_type AS "accessType", q.valid_from AS "validFrom", q.valid_until AS "validUntil",
  q.decided_by AS "decidedBy", q.decided_at AS "decidedAt", q.decision_comment AS "decisionComment"`;

export async function getRequestForTicket(
  ticketId: number,
  transaction?: Transaction,
  options: { lock?: boolean } = {},
): Promise<RoomAccessRequestRow | null> {
  const [row] = await postgres.query<RoomAccessRequestRow>(
    `SELECT ${REQUEST_COLUMNS}
       FROM comm_room_access_requests q
       JOIN comm_rooms r ON r.id = q.room_id
       JOIN cost_centers cc ON cc.id = r.cost_center_id
      WHERE q.ticket_id = :ticketId ${options.lock ? "FOR UPDATE OF q" : ""}`,
    { replacements: { ticketId }, type: QueryTypes.SELECT, transaction },
  );
  return row ?? null;
}

export interface RoomAccessValidation {
  roomId: number;
  accessType: RoomAccessType;
  validFrom: string;
  validUntil: string | null;
  notes?: string | null;
}

// El agente fija sala, tipo y periodo. Devuelve avisos que no bloquean el envio a aprobacion.
export async function markRequestValidated(
  request: RoomAccessRequestRow,
  input: RoomAccessValidation,
  userId: number,
  transaction: Transaction,
): Promise<{ roomName: string; warnings: string[] }> {
  if (request.status !== "REQUESTED") throw new ConflictError("La solicitud de acceso ya fue validada");
  const room = await assertActiveRoom(input.roomId, transaction);
  const from = new Date(input.validFrom);
  const until = input.validUntil ? new Date(input.validUntil) : null;
  const periodError = roomAccessPeriodError(input.accessType, from, until);
  if (periodError) throw new BadRequestError(periodError);
  if (until && until.getTime() <= Date.now()) throw new BadRequestError("El periodo ya termino: indique una fecha de termino futura");

  await postgres.query(
    `UPDATE comm_room_access_requests
        SET room_id = :roomId, access_type = :accessType, valid_from = :from, valid_until = :until,
            validation_notes = :notes, validated_by = :userId, validated_at = now(), status = 'VALIDATED', updated_at = now()
      WHERE id = :id`,
    {
      replacements: { id: request.id, roomId: input.roomId, accessType: input.accessType, from, until, notes: input.notes?.trim() || null, userId },
      transaction,
    },
  );

  const warnings: string[] = [];
  const [overlap] = await postgres.query(
    `SELECT 1 FROM comm_room_access_grants
      WHERE room_id = :roomId AND beneficiary_document_id = :documentId AND ${VALID_NOW} LIMIT 1`,
    { replacements: { roomId: input.roomId, documentId: request.beneficiaryDocumentId }, type: QueryTypes.SELECT, transaction },
  );
  if (overlap) warnings.push("El beneficiario ya tiene un acceso vigente a esta sala");
  if (input.accessType === "TEMPORARY" && until) {
    const { temporaryMaxActiveDays } = await getSettings(transaction);
    if ((until.getTime() - from.getTime()) / 86_400_000 > temporaryMaxActiveDays) {
      warnings.push(`El acceso temporal supera los ${temporaryMaxActiveDays} días: aparecerá como prolongado`);
    }
  }
  return { roomName: room.name, warnings };
}

// Al aprobar: el grant es el registro oficial. request_id UNIQUE impide dos grants por una solicitud.
export async function createGrantFromRequest(
  request: RoomAccessRequestRow,
  approverId: number,
  comment: string | null,
  transaction: Transaction,
): Promise<number> {
  if (request.status !== "VALIDATED" || !request.accessType || !request.validFrom || request.validatedBy === null) {
    throw new ConflictError("La solicitud de acceso no esta validada");
  }
  if (!request.roomIsActive) throw new ConflictError(`La sala ${request.roomName} fue desactivada: rechace la solicitud`);
  if (request.validUntil && new Date(request.validUntil).getTime() <= Date.now()) {
    throw new ConflictError("El periodo validado ya termino: rechace la solicitud y pida una nueva");
  }
  const [grant] = await postgres.query<{ id: number }>(
    `INSERT INTO comm_room_access_grants (request_id, ticket_id, room_id, beneficiary_kind, beneficiary_person_id,
                                          beneficiary_name, beneficiary_document_id, beneficiary_company, reason,
                                          access_type, valid_from, valid_until, validated_by, approved_by)
     SELECT id, ticket_id, room_id, beneficiary_kind, beneficiary_person_id, beneficiary_name, beneficiary_document_id,
            beneficiary_company, reason, access_type, valid_from, valid_until, validated_by, :approverId
       FROM comm_room_access_requests WHERE id = :id
     RETURNING id`,
    { replacements: { id: request.id, approverId }, type: QueryTypes.SELECT, transaction },
  );
  await setRequestDecision(request.id, "APPROVED", approverId, comment, transaction);
  return grant!.id;
}

export async function setRequestDecision(
  requestId: number,
  status: "APPROVED" | "REJECTED",
  userId: number,
  comment: string | null,
  transaction: Transaction,
): Promise<void> {
  await postgres.query(
    `UPDATE comm_room_access_requests
        SET status = :status, decided_by = :userId, decided_at = now(), decision_comment = :comment, updated_at = now()
      WHERE id = :id`,
    { replacements: { id: requestId, status, userId, comment }, transaction },
  );
}

// Anular el ticket (solicitante, agente o rechazo) cierra la solicitud que siga abierta.
export async function cancelOpenRequest(ticketId: number, transaction: Transaction): Promise<void> {
  await postgres.query(
    `UPDATE comm_room_access_requests SET status = 'CANCELLED', updated_at = now()
      WHERE ticket_id = :ticketId AND status IN ('REQUESTED','VALIDATED')`,
    { replacements: { ticketId }, transaction },
  );
}

// ---------------------------------------------------------------------------
// Registros de acceso (grants)
// ---------------------------------------------------------------------------
// Vigente = activo y dentro del periodo, con el reloj de la base: el barrido corre cada minuto y no
// puede dejar pasar a alguien cuyo acceso ya termino.
export const VALID_NOW = `status = 'ACTIVE' AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now())`;
const G_VALID_NOW = `(g.status = 'ACTIVE' AND g.valid_from <= now() AND (g.valid_until IS NULL OR g.valid_until > now()))`;

export type GrantStatus = "ACTIVE" | "EXPIRED" | "REVOKED";

export interface RoomAccessGrant {
  id: number;
  ticketId: number;
  ticketNumber: string;
  roomId: number;
  roomName: string;
  costCenterId: number;
  costCenterName: string;
  beneficiaryKind: RoomBeneficiaryKind;
  beneficiaryName: string;
  beneficiaryDocumentId: string;
  beneficiaryCompany: string | null;
  reason: string;
  accessType: RoomAccessType;
  validFrom: Date;
  validUntil: Date | null;
  status: GrantStatus;
  // ACTIVE con inicio futuro: aprobado pero todavia no habilita el ingreso.
  isValidNow: boolean;
  validatedBy: number;
  validatedByName: string | null;
  approvedBy: number;
  approvedByName: string | null;
  approvedAt: Date;
  expiredAt: Date | null;
  revokedBy: number | null;
  revokedByName: string | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  activeDays: number;
}

type GrantRow = Omit<RoomAccessGrant, "validatedByName" | "approvedByName" | "revokedByName">;

const GRANT_SELECT = `
  SELECT g.id, g.ticket_id AS "ticketId", t.number AS "ticketNumber", g.room_id AS "roomId", r.name AS "roomName",
         r.cost_center_id AS "costCenterId", cc.name AS "costCenterName", g.beneficiary_kind AS "beneficiaryKind",
         g.beneficiary_name AS "beneficiaryName", g.beneficiary_document_id AS "beneficiaryDocumentId",
         g.beneficiary_company AS "beneficiaryCompany", g.reason, g.access_type AS "accessType",
         g.valid_from AS "validFrom", g.valid_until AS "validUntil", g.status,
         ${G_VALID_NOW} AS "isValidNow",
         g.validated_by AS "validatedBy", g.approved_by AS "approvedBy", g.approved_at AS "approvedAt",
         g.expired_at AS "expiredAt", g.revoked_by AS "revokedBy", g.revoked_at AS "revokedAt", g.revoke_reason AS "revokeReason",
         GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - g.valid_from)) / 86400))::int AS "activeDays"
    FROM comm_room_access_grants g
    JOIN service_tickets t ON t.id = g.ticket_id
    JOIN comm_rooms r ON r.id = g.room_id
    JOIN cost_centers cc ON cc.id = r.cost_center_id`;

async function withGrantNames(rows: GrantRow[]): Promise<RoomAccessGrant[]> {
  const directory = await getUserDirectory(rows.flatMap((row) => [row.validatedBy, row.approvedBy, row.revokedBy ?? 0]));
  const nameOf = (id: number | null) => (id ? (directory.get(id)?.fullName ?? `Usuario ${id}`) : null);
  return rows.map((row) => ({
    ...row,
    validatedByName: nameOf(row.validatedBy),
    approvedByName: nameOf(row.approvedBy),
    revokedByName: nameOf(row.revokedBy),
  }));
}

export interface GrantFilters {
  roomId?: number;
  costCenterId?: number;
  status?: GrantStatus;
  accessType?: RoomAccessType;
  validNow?: boolean;
  documentId?: string;
  ticketNumber?: string;
  expiredFrom?: Date;
  expiredTo?: Date;
  // Temporales activos hace mas de N dias (N de la configuracion).
  longTemporary?: boolean;
}

const GRANT_SORT_COLUMNS: Record<string, string> = {
  id: "g.id",
  validFrom: "g.valid_from",
  validUntil: "g.valid_until",
  beneficiaryName: "g.beneficiary_name",
  roomName: "r.name",
};
export const GRANT_SORT_FIELDS = Object.keys(GRANT_SORT_COLUMNS);

export async function listGrants(params: PaginationParams, filters: GrantFilters): Promise<{ items: RoomAccessGrant[]; total: number }> {
  const conditions: string[] = [];
  const replacements: Record<string, unknown> = {};
  if (filters.roomId) {
    conditions.push("g.room_id = :roomId");
    replacements.roomId = filters.roomId;
  }
  if (filters.costCenterId) {
    conditions.push("r.cost_center_id = :costCenterId");
    replacements.costCenterId = filters.costCenterId;
  }
  if (filters.status) {
    conditions.push("g.status = :status");
    replacements.status = filters.status;
  }
  if (filters.accessType) {
    conditions.push("g.access_type = :accessType");
    replacements.accessType = filters.accessType;
  }
  if (filters.validNow) conditions.push(G_VALID_NOW);
  // RUT solo exacto: nunca una busqueda parcial en una pantalla que muestra nombres.
  if (filters.documentId) {
    conditions.push("g.beneficiary_document_id = :documentId");
    replacements.documentId = normalizeRut(filters.documentId);
  }
  if (filters.ticketNumber) {
    conditions.push("t.number = :ticketNumber");
    replacements.ticketNumber = filters.ticketNumber.trim().toUpperCase();
  }
  if (filters.expiredFrom || filters.expiredTo) {
    conditions.push("g.status = 'EXPIRED'");
    if (filters.expiredFrom) {
      conditions.push("g.expired_at >= :expiredFrom");
      replacements.expiredFrom = filters.expiredFrom;
    }
    if (filters.expiredTo) {
      conditions.push("g.expired_at < :expiredTo");
      replacements.expiredTo = filters.expiredTo;
    }
  }
  if (filters.longTemporary) {
    const { temporaryMaxActiveDays } = await getSettings();
    conditions.push("g.access_type = 'TEMPORARY' AND g.status = 'ACTIVE' AND now() - g.valid_from > make_interval(days => :maxDays)");
    replacements.maxDays = temporaryMaxActiveDays;
  }
  if (params.search) {
    conditions.push("(g.beneficiary_name ILIKE :search OR g.beneficiary_company ILIKE :search OR r.name ILIKE :search)");
    replacements.search = `%${params.search}%`;
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = `${GRANT_SORT_COLUMNS[params.sortBy] ?? "g.id"} ${params.sortOrder === "asc" ? "ASC" : "DESC"} NULLS LAST, g.id DESC`;
  const [count] = await postgres.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM comm_room_access_grants g
       JOIN service_tickets t ON t.id = g.ticket_id
       JOIN comm_rooms r ON r.id = g.room_id ${where}`,
    { replacements, type: QueryTypes.SELECT },
  );
  const rows = await postgres.query<GrantRow>(`${GRANT_SELECT} ${where} ORDER BY ${order} LIMIT :limit OFFSET :offset`, {
    replacements: { ...replacements, limit: params.limit, offset: getOffset(params) },
    type: QueryTypes.SELECT,
  });
  return { items: await withGrantNames(rows), total: count?.total ?? 0 };
}

export async function getGrantOrThrow(id: number): Promise<RoomAccessGrant> {
  const rows = await postgres.query<GrantRow>(`${GRANT_SELECT} WHERE g.id = :id`, { replacements: { id }, type: QueryTypes.SELECT });
  if (rows.length === 0) throw new NotFoundError(`El acceso ${id} no existe`);
  return (await withGrantNames(rows))[0]!;
}

async function addTicketEventRaw(
  transaction: Transaction,
  ticketId: number,
  eventType: string,
  actorUserId: number | null,
  body: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // Directo a la tabla (y no via ticket.service) para no crear un ciclo de imports con el ticket.
  await postgres.query(
    `INSERT INTO service_ticket_events (ticket_id, event_type, actor_user_id, is_public, body, payload)
     VALUES (:ticketId, :eventType, :actorUserId, false, :body, CAST(:payload AS JSONB))`,
    { replacements: { ticketId, eventType, actorUserId, body, payload: JSON.stringify(payload) }, transaction },
  );
}

export { addTicketEventRaw as addRoomAccessTicketEvent };

export async function revokeGrant(id: number, reason: string, userId: number): Promise<RoomAccessGrant> {
  await postgres.transaction(async (transaction) => {
    const [grant] = await postgres.query<{ status: GrantStatus; ticketId: number }>(
      `SELECT status, ticket_id AS "ticketId" FROM comm_room_access_grants WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction },
    );
    if (!grant) throw new NotFoundError(`El acceso ${id} no existe`);
    if (grant.status !== "ACTIVE") throw new ConflictError("Solo se revoca un acceso activo");
    await postgres.query(
      `UPDATE comm_room_access_grants SET status = 'REVOKED', revoked_by = :userId, revoked_at = now(), revoke_reason = :reason
        WHERE id = :id`,
      { replacements: { id, userId, reason: reason.trim() }, transaction },
    );
    await addTicketEventRaw(transaction, grant.ticketId, "ROOM_ACCESS_REVOKED", userId, `Acceso revocado: ${reason.trim()}`, { grantId: id });
  });
  return getGrantOrThrow(id);
}

// ---------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------
export interface MultiRoomHolder {
  beneficiaryDocumentId: string;
  beneficiaryName: string;
  beneficiaryKind: RoomBeneficiaryKind;
  beneficiaryCompany: string | null;
  places: number;
  rooms: { roomId: number; roomName: string; costCenterName: string; grantId: number; accessType: RoomAccessType; validUntil: Date | null }[];
}

// Personas con acceso vigente a varias salas (by=room) o a varias tiendas/centros de costo (by=costCenter).
export async function listMultiRoomHolders(by: "room" | "costCenter", minPlaces: number): Promise<MultiRoomHolder[]> {
  const distinct = by === "room" ? "g.room_id" : "r.cost_center_id";
  return postgres.query<MultiRoomHolder>(
    `SELECT g.beneficiary_document_id AS "beneficiaryDocumentId", max(g.beneficiary_name) AS "beneficiaryName",
            max(g.beneficiary_kind) AS "beneficiaryKind", max(g.beneficiary_company) AS "beneficiaryCompany",
            COUNT(DISTINCT ${distinct})::int AS places,
            json_agg(json_build_object('roomId', g.room_id, 'roomName', r.name, 'costCenterName', cc.name, 'grantId', g.id,
                                       'accessType', g.access_type, 'validUntil', g.valid_until) ORDER BY cc.name, r.name) AS rooms
       FROM comm_room_access_grants g
       JOIN comm_rooms r ON r.id = g.room_id
       JOIN cost_centers cc ON cc.id = r.cost_center_id
      WHERE ${G_VALID_NOW}
      GROUP BY g.beneficiary_document_id
     HAVING COUNT(DISTINCT ${distinct}) >= :minPlaces
      ORDER BY places DESC, "beneficiaryName"
      LIMIT 500`,
    { replacements: { minPlaces }, type: QueryTypes.SELECT },
  );
}
