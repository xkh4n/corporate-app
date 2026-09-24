import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { BadRequestError, ConflictError, NotFoundError } from "../../../library/errors";
import { withProductNames } from "../assetAccounting.service";
import { createAssetMovement, listCurrentHoldersByAssetIds, MOVEMENT_TYPES_REQUIRING_USERS } from "../assetMovement.service";
import { lockAssetRow } from "../asset.service";
import { getUserDirectory } from "../../mssql/user.service";
import { assertTicketInScope, resolveTicketScope, ticketScopeCondition, type ScopeActor, type TicketScope } from "./ticketScope";

// Activos involucrados en un ticket (plan 009, fase 9B). El ticket solo los
// vincula (trazabilidad); moverlos es una accion explicita del agente:
// "Enviar a soporte" (SUPPORT) y la vuelta al tenedor (SUPPORT_TO_HOLDER) o a
// bodega (SUPPORT_TO_STOCK), todo registrado en asset_movements.

export const MAX_ASSETS_PER_TICKET = 20;
// Un activo con esta cantidad de incidentes en la ventana sugiere abrir un problema.
export const RECURRENCE_THRESHOLD = 3;
export const RECURRENCE_WINDOW_DAYS = 90;
// Estados desde los que un activo puede ir a soporte.
const SENDABLE_STATUSES = ["ASSIGNED", "AVAILABLE"];

export interface TicketAsset {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  statusCode: string;
  costCenterName: string | null;
  productName: string | null;
  holderUserId: number | null;
  holderName: string | null;
  statusBefore: string | null;
  inSupport: boolean;
  supportMovementId: number | null;
  returnMovementId: number | null;
  linkedAt: Date;
  recentIncidentCount: number;
}

export async function listTicketAssets(ticketId: number, transaction?: Transaction): Promise<TicketAsset[]> {
  const rows = await postgres.query<Omit<TicketAsset, "productName" | "holderName"> & { productId: string | null }>(
    `SELECT a.id AS "assetId", a.tag, a.serial_number AS "serialNumber", s.code AS "statusCode", cc.name AS "costCenterName",
            a.product_id AS "productId", l.holder_user_id AS "holderUserId", l.status_before AS "statusBefore",
            (l.support_movement_id IS NOT NULL AND l.return_movement_id IS NULL) AS "inSupport",
            l.support_movement_id AS "supportMovementId", l.return_movement_id AS "returnMovementId", l.linked_at AS "linkedAt",
            (SELECT COUNT(*)::int FROM service_ticket_assets x JOIN service_tickets t ON t.id = x.ticket_id
              WHERE x.asset_id = a.id AND t.type = 'INCIDENT'
                AND t.created_at > now() - make_interval(days => :windowDays)) AS "recentIncidentCount"
       FROM service_ticket_assets l
       JOIN assets a ON a.id = l.asset_id
       JOIN asset_statuses s ON s.id = a.status_id
       LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
      WHERE l.ticket_id = :ticketId
      ORDER BY a.tag`,
    { replacements: { ticketId, windowDays: RECURRENCE_WINDOW_DAYS }, type: QueryTypes.SELECT, transaction },
  );
  const withProducts = await withProductNames(rows);
  const directory = await getUserDirectory(rows.map((row) => row.holderUserId ?? 0));
  return withProducts.map((row) => ({
    ...row,
    holderName: row.holderUserId ? (directory.get(row.holderUserId)?.fullName ?? `Usuario ${row.holderUserId}`) : null,
  }));
}

// Vincula activos dentro de la transaccion del ticket. ownOnlyFor: en el
// portal el solicitante solo puede declarar activos que tiene asignados.
export async function linkAssetsInTransaction(
  ticketId: number,
  assetIds: number[],
  userId: number,
  options: { ownOnlyFor: number | null },
  transaction: Transaction,
): Promise<void> {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return;
  const [current] = await postgres.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM service_ticket_assets WHERE ticket_id = :ticketId`,
    { replacements: { ticketId }, type: QueryTypes.SELECT, transaction },
  );
  if ((current?.total ?? 0) + ids.length > MAX_ASSETS_PER_TICKET) {
    throw new BadRequestError(`Un ticket admite hasta ${MAX_ASSETS_PER_TICKET} activos`);
  }
  const assets = await postgres.query<{ id: number; tag: string; statusCode: string }>(
    `SELECT a.id, a.tag, s.code AS "statusCode" FROM assets a JOIN asset_statuses s ON s.id = a.status_id WHERE a.id IN (:ids)`,
    { replacements: { ids }, type: QueryTypes.SELECT, transaction },
  );
  const missing = ids.filter((id) => !assets.some((asset) => asset.id === id));
  if (missing.length > 0) throw new BadRequestError("Algunos activos no existen", { missingAssetIds: missing });

  const holders = await listCurrentHoldersByAssetIds(ids, transaction);
  if (options.ownOnlyFor !== null) {
    const notOwn = assets.filter((asset) => holders.get(asset.id) !== options.ownOnlyFor);
    if (notOwn.length > 0) {
      throw new ConflictError("Solo puede declarar activos que tiene asignados", { assetIds: notOwn.map((asset) => asset.id) });
    }
  }
  for (const asset of assets) {
    const [inserted] = await postgres.query<{ assetId: number }>(
      `INSERT INTO service_ticket_assets (ticket_id, asset_id, holder_user_id, status_before, linked_by)
       VALUES (:ticketId, :assetId, :holderUserId, :statusBefore, :userId)
       ON CONFLICT (ticket_id, asset_id) DO NOTHING RETURNING asset_id AS "assetId"`,
      {
        replacements: {
          ticketId,
          assetId: asset.id,
          holderUserId: holders.get(asset.id) ?? null,
          statusBefore: asset.statusCode,
          userId,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    if (inserted) {
      await postgres.query(
        `INSERT INTO service_ticket_events (ticket_id, event_type, actor_user_id, is_public, payload)
         VALUES (:ticketId, 'ASSET_LINKED', :userId, true, CAST(:payload AS JSONB))`,
        { replacements: { ticketId, userId, payload: JSON.stringify({ assetId: asset.id, tag: asset.tag }) }, transaction },
      );
    }
  }
}

// Bloquea el ticket abierto y exige que este dentro del alcance del agente (sus grupos).
async function lockOpenTicket(
  ticketId: number,
  actor: ScopeActor,
  transaction: Transaction,
): Promise<{ number: string; status: string }> {
  const [row] = await postgres.query<{ id: number; number: string; status: string; assignedGroupId: number | null }>(
    `SELECT id, number, status, assigned_group_id AS "assignedGroupId" FROM service_tickets WHERE id = :ticketId FOR UPDATE`,
    { replacements: { ticketId }, type: QueryTypes.SELECT, transaction },
  );
  if (!row) throw new NotFoundError(`El ticket ${ticketId} no existe`);
  assertTicketInScope(await resolveTicketScope(actor, transaction), row);
  if (["RESOLVED", "CLOSED", "CANCELLED"].includes(row.status)) {
    throw new ConflictError(`El ticket ${row.number} esta ${row.status}: sus activos ya no se modifican`);
  }
  return row;
}

async function lockLink(ticketId: number, assetId: number, transaction: Transaction) {
  const [link] = await postgres.query<{
    holderUserId: number | null;
    statusBefore: string | null;
    supportMovementId: number | null;
    returnMovementId: number | null;
  }>(
    `SELECT holder_user_id AS "holderUserId", status_before AS "statusBefore", support_movement_id AS "supportMovementId",
            return_movement_id AS "returnMovementId"
       FROM service_ticket_assets WHERE ticket_id = :ticketId AND asset_id = :assetId FOR UPDATE`,
    { replacements: { ticketId, assetId }, type: QueryTypes.SELECT, transaction },
  );
  if (!link) throw new NotFoundError(`El activo ${assetId} no esta vinculado al ticket`);
  return link;
}

export async function linkAssets(ticketId: number, assetIds: number[], actor: ScopeActor): Promise<void> {
  const userId = actor.userId;
  await postgres.transaction(async (transaction) => {
    await lockOpenTicket(ticketId, actor, transaction);
    await linkAssetsInTransaction(ticketId, assetIds, userId, { ownOnlyFor: null }, transaction);
    await postgres.query(`UPDATE service_tickets SET updated_at = now() WHERE id = :ticketId`, { replacements: { ticketId }, transaction });
  });
}

export async function unlinkAsset(ticketId: number, assetId: number, actor: ScopeActor): Promise<void> {
  const userId = actor.userId;
  await postgres.transaction(async (transaction) => {
    await lockOpenTicket(ticketId, actor, transaction);
    const link = await lockLink(ticketId, assetId, transaction);
    if (link.supportMovementId !== null) {
      throw new ConflictError("El activo ya paso por soporte en este ticket: queda vinculado como registro");
    }
    await postgres.query(`DELETE FROM service_ticket_assets WHERE ticket_id = :ticketId AND asset_id = :assetId`, {
      replacements: { ticketId, assetId },
      transaction,
    });
    await postgres.query(
      `INSERT INTO service_ticket_events (ticket_id, event_type, actor_user_id, is_public, payload)
       VALUES (:ticketId, 'ASSET_UNLINKED', :userId, true, CAST(:payload AS JSONB))`,
      { replacements: { ticketId, userId, payload: JSON.stringify({ assetId }) }, transaction },
    );
  });
}

export async function sendAssetToSupport(ticketId: number, assetId: number, actor: ScopeActor, notes?: string): Promise<void> {
  const userId = actor.userId;
  await postgres.transaction(async (transaction) => {
    const ticket = await lockOpenTicket(ticketId, actor, transaction);
    // Solo un ticket que ya se atiende saca el activo a soporte: uno pendiente o
    // en cola podria anularse con el activo afuera (run-3, F5).
    if (!["ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(ticket.status)) {
      throw new ConflictError(`Asigne el ticket ${ticket.number} a un agente antes de enviar activos a soporte`);
    }
    const link = await lockLink(ticketId, assetId, transaction);
    if (link.supportMovementId !== null && link.returnMovementId === null) {
      throw new ConflictError("El activo ya esta en soporte por este ticket");
    }
    await lockAssetRow(assetId, transaction);
    const [asset] = await postgres.query<{ tag: string; statusCode: string }>(
      `SELECT a.tag, s.code AS "statusCode" FROM assets a JOIN asset_statuses s ON s.id = a.status_id WHERE a.id = :assetId`,
      { replacements: { assetId }, type: QueryTypes.SELECT, transaction },
    );
    if (!asset || !SENDABLE_STATUSES.includes(asset.statusCode)) {
      throw new ConflictError(`El activo ${asset?.tag ?? assetId} no puede ir a soporte (estado actual: ${asset?.statusCode ?? "desconocido"})`);
    }
    // Foto del tenedor al momento de salir: es a quien vuelve el activo.
    const holders = await listCurrentHoldersByAssetIds([assetId], transaction);
    const movement = await createAssetMovement(
      { assetId, movementType: "SUPPORT", notes: `Ticket ${ticket.number}${notes ? `: ${notes}` : ""}`.slice(0, 255), createdBy: userId },
      transaction,
    );
    try {
      await postgres.query(
        `UPDATE service_ticket_assets SET support_movement_id = :movementId, return_movement_id = NULL,
                holder_user_id = :holderUserId, status_before = :statusBefore
          WHERE ticket_id = :ticketId AND asset_id = :assetId`,
        {
          replacements: {
            ticketId,
            assetId,
            movementId: movement.id,
            holderUserId: holders.get(assetId) ?? null,
            statusBefore: asset.statusCode,
          },
          transaction,
        },
      );
    } catch (err) {
      if (err instanceof Error && err.name === "SequelizeUniqueConstraintError") {
        throw new ConflictError(`El activo ${asset.tag} ya esta en soporte por otro ticket`);
      }
      throw err;
    }
    await postgres.query(
      `INSERT INTO service_ticket_events (ticket_id, event_type, actor_user_id, is_public, body, payload)
       VALUES (:ticketId, 'ASSET_TO_SUPPORT', :userId, true, :notes, CAST(:payload AS JSONB))`,
      {
        replacements: {
          ticketId,
          userId,
          notes: notes ?? null,
          payload: JSON.stringify({ assetId, tag: asset.tag, movementId: movement.id }),
        },
        transaction,
      },
    );
  });
}

export async function returnAssetFromSupport(
  ticketId: number,
  assetId: number,
  target: "HOLDER" | "STOCK",
  actor: ScopeActor,
  notes?: string,
): Promise<void> {
  const userId = actor.userId;
  await postgres.transaction(async (transaction) => {
    const ticket = await lockOpenTicket(ticketId, actor, transaction);
    const link = await lockLink(ticketId, assetId, transaction);
    if (link.supportMovementId === null || link.returnMovementId !== null) {
      throw new ConflictError("El activo no esta en soporte por este ticket");
    }
    if (target === "HOLDER" && link.holderUserId === null) {
      throw new ConflictError("El activo no tenia tenedor al ir a soporte: devuelvalo a bodega");
    }
    const movementType = target === "HOLDER" ? "SUPPORT_TO_HOLDER" : "SUPPORT_TO_STOCK";
    const movement = await createAssetMovement(
      {
        assetId,
        movementType,
        userIds: MOVEMENT_TYPES_REQUIRING_USERS.has(movementType) ? [link.holderUserId!] : [],
        notes: `Ticket ${ticket.number}${notes ? `: ${notes}` : ""}`.slice(0, 255),
        createdBy: userId,
      },
      transaction,
    );
    await postgres.query(
      `UPDATE service_ticket_assets SET return_movement_id = :movementId WHERE ticket_id = :ticketId AND asset_id = :assetId`,
      { replacements: { ticketId, assetId, movementId: movement.id }, transaction },
    );
    await postgres.query(
      `INSERT INTO service_ticket_events (ticket_id, event_type, actor_user_id, is_public, body, payload)
       VALUES (:ticketId, 'ASSET_RETURNED', :userId, true, :notes, CAST(:payload AS JSONB))`,
      {
        replacements: {
          ticketId,
          userId,
          notes: notes ?? null,
          payload: JSON.stringify({ assetId, target, holderUserId: link.holderUserId, movementId: movement.id }),
        },
        transaction,
      },
    );
  });
}

// Un ticket no se resuelve mientras un activo que envio a soporte no haya vuelto.
export async function assertNoAssetInSupport(ticketId: number, transaction: Transaction): Promise<void> {
  const rows = await postgres.query<{ tag: string }>(
    `SELECT a.tag FROM service_ticket_assets l JOIN assets a ON a.id = l.asset_id
      WHERE l.ticket_id = :ticketId AND l.support_movement_id IS NOT NULL AND l.return_movement_id IS NULL`,
    { replacements: { ticketId }, type: QueryTypes.SELECT, transaction },
  );
  if (rows.length > 0) {
    throw new ConflictError(
      `Devuelva al custodio o a bodega los activos en soporte antes de resolver, cerrar o anular el ticket: ${rows.map((row) => row.tag).join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Consultas para el portal y la ficha del activo
// ---------------------------------------------------------------------------
export interface HeldAsset {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  productName: string | null;
  statusCode: string;
}

// Activos que el usuario tiene asignados hoy (tenedor vigente = ultimo movimiento con usuario).
export async function listAssetsHeldBy(userId: number): Promise<HeldAsset[]> {
  const types = [...MOVEMENT_TYPES_REQUIRING_USERS];
  const rows = await postgres.query<Omit<HeldAsset, "productName"> & { productId: string | null }>(
    `SELECT a.id AS "assetId", a.tag, a.serial_number AS "serialNumber", a.product_id AS "productId", s.code AS "statusCode"
       FROM assets a
       JOIN asset_statuses s ON s.id = a.status_id
       JOIN LATERAL (SELECT m.id, m.movement_type FROM asset_movements m WHERE m.asset_id = a.id
                      ORDER BY m.movement_date DESC, m.id DESC LIMIT 1) last ON true
      WHERE last.movement_type IN (:types)
        AND EXISTS (SELECT 1 FROM asset_movement_users mu WHERE mu.asset_movement_id = last.id AND mu.user_id = :userId)
      ORDER BY a.tag
      LIMIT 200`,
    { replacements: { userId, types }, type: QueryTypes.SELECT },
  );
  return withProductNames(rows);
}

// Busqueda para vincular activos desde el ticket (por etiqueta o numero de serie).
export async function searchAssets(search: string): Promise<(HeldAsset & { holderName: string | null })[]> {
  const term = search.trim();
  if (term.length < 2) return [];
  const rows = await postgres.query<Omit<HeldAsset, "productName"> & { productId: string | null }>(
    `SELECT a.id AS "assetId", a.tag, a.serial_number AS "serialNumber", a.product_id AS "productId", s.code AS "statusCode"
       FROM assets a JOIN asset_statuses s ON s.id = a.status_id
      WHERE a.tag ILIKE :term OR a.serial_number ILIKE :term
      ORDER BY a.tag LIMIT 20`,
    { replacements: { term: `%${term}%` }, type: QueryTypes.SELECT },
  );
  const holders = await listCurrentHoldersByAssetIds(rows.map((row) => row.assetId));
  const directory = await getUserDirectory([...holders.values()]);
  return (await withProductNames(rows)).map((row) => {
    const holderId = holders.get(row.assetId);
    return { ...row, holderName: holderId ? (directory.get(holderId)?.fullName ?? null) : null };
  });
}

export interface AssetServiceRecord {
  kind: "TICKET" | "PROBLEM" | "CHANGE";
  id: number;
  number: string;
  type: string;
  status: string;
  title: string;
  priority: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

// Historial de servicio del activo: tickets, problemas y cambios que lo involucran.
// Los tickets se acotan al alcance del agente (sus grupos).
export async function listAssetServiceHistory(assetId: number, scope: TicketScope): Promise<AssetServiceRecord[]> {
  const [asset] = await postgres.query(`SELECT id FROM assets WHERE id = :assetId`, {
    replacements: { assetId },
    type: QueryTypes.SELECT,
  });
  if (!asset) throw new NotFoundError(`El activo ${assetId} no existe`);
  const replacements: Record<string, unknown> = { assetId };
  const scopeCondition = ticketScopeCondition(scope, replacements);
  return postgres.query<AssetServiceRecord>(
    `SELECT 'TICKET' AS kind, t.id, t.number, t.type, t.status, t.title, t.priority, t.created_at AS "createdAt",
            t.closed_at AS "closedAt"
       FROM service_ticket_assets l JOIN service_tickets t ON t.id = l.ticket_id
      WHERE l.asset_id = :assetId ${scopeCondition ? `AND ${scopeCondition}` : ""}
     UNION ALL
     SELECT 'PROBLEM', p.id, p.number, 'PROBLEM', p.status, p.title, p.priority, p.created_at, p.closed_at
       FROM service_problem_assets l JOIN service_problems p ON p.id = l.problem_id WHERE l.asset_id = :assetId
     UNION ALL
     SELECT 'CHANGE', c.id, c.number, c.type, c.status, c.title, NULL, c.created_at, c.closed_at
       FROM service_change_assets l JOIN service_changes c ON c.id = l.change_id WHERE l.asset_id = :assetId
     ORDER BY "createdAt" DESC
     LIMIT 200`,
    { replacements, type: QueryTypes.SELECT },
  );
}
