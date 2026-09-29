import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { BadRequestError, ConflictError, NotFoundError } from "../../../library/errors";
import { isUniqueConstraintError } from "../../../library/errors";
import type { PaginationParams } from "../../../library/pagination";
import { getOffset } from "../../../library/pagination";
import { escapeLikePattern } from "../../../library/sequelizeSearch";

// Salas de comunicaciones (plan 016): cada una depende de un centro de costo (tienda, sucursal).

export interface CommRoom {
  id: number;
  name: string;
  costCenterId: number;
  costCenterCode: number;
  costCenterName: string;
  address: string;
  isActive: boolean;
  activeGrants: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommRoomInput {
  name: string;
  costCenterId: number;
  address: string;
  isActive?: boolean;
}

export interface CommRoomFilters {
  costCenterId?: number;
  isActive?: boolean;
}

const ROOM_SELECT = `
  SELECT r.id, r.name, r.cost_center_id AS "costCenterId", cc.code AS "costCenterCode", cc.name AS "costCenterName",
         r.address, r.is_active AS "isActive", r.created_at AS "createdAt", r.updated_at AS "updatedAt",
         (SELECT COUNT(*)::int FROM comm_room_access_grants g WHERE g.room_id = r.id AND g.status = 'ACTIVE') AS "activeGrants"
    FROM comm_rooms r
    JOIN cost_centers cc ON cc.id = r.cost_center_id`;

const SORT_COLUMNS: Record<string, string> = {
  id: "r.id",
  name: "r.name",
  costCenter: "cc.code",
  createdAt: "r.created_at",
};
export const COMM_ROOM_SORT_FIELDS = Object.keys(SORT_COLUMNS);

export async function listRooms(params: PaginationParams, filters: CommRoomFilters): Promise<{ items: CommRoom[]; total: number }> {
  const conditions: string[] = [];
  const replacements: Record<string, unknown> = {};
  if (filters.costCenterId) {
    conditions.push("r.cost_center_id = :costCenterId");
    replacements.costCenterId = filters.costCenterId;
  }
  if (filters.isActive !== undefined) {
    conditions.push("r.is_active = :isActive");
    replacements.isActive = filters.isActive;
  }
  if (params.search) {
    conditions.push("(r.name ILIKE :search OR cc.name ILIKE :search OR r.address ILIKE :search)");
    replacements.search = `%${escapeLikePattern(params.search)}%`;
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = `${SORT_COLUMNS[params.sortBy] ?? "r.id"} ${params.sortOrder === "asc" ? "ASC" : "DESC"}, r.id`;
  const [count] = await postgres.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM comm_rooms r JOIN cost_centers cc ON cc.id = r.cost_center_id ${where}`,
    { replacements, type: QueryTypes.SELECT },
  );
  const items = await postgres.query<CommRoom>(`${ROOM_SELECT} ${where} ORDER BY ${order} LIMIT :limit OFFSET :offset`, {
    replacements: { ...replacements, limit: params.limit, offset: getOffset(params) },
    type: QueryTypes.SELECT,
  });
  return { items, total: count?.total ?? 0 };
}

export async function getRoomOrThrow(id: number, transaction?: Transaction): Promise<CommRoom> {
  const [room] = await postgres.query<CommRoom>(`${ROOM_SELECT} WHERE r.id = :id`, {
    replacements: { id },
    type: QueryTypes.SELECT,
    transaction,
  });
  if (!room) throw new NotFoundError(`La sala ${id} no existe`);
  return room;
}

// Lo que ve el portal al pedir acceso: sin la direccion, que no hace falta para pedirlo.
export async function listPortalRooms(): Promise<{ id: number; name: string; costCenterName: string }[]> {
  return postgres.query(
    `SELECT r.id, r.name, cc.name AS "costCenterName"
       FROM comm_rooms r JOIN cost_centers cc ON cc.id = r.cost_center_id
      WHERE r.is_active ORDER BY cc.name, r.name`,
    { type: QueryTypes.SELECT },
  );
}

async function assertCostCenter(costCenterId: number, transaction?: Transaction): Promise<void> {
  const [row] = await postgres.query(`SELECT 1 FROM cost_centers WHERE id = :id`, {
    replacements: { id: costCenterId },
    type: QueryTypes.SELECT,
    transaction,
  });
  if (!row) throw new BadRequestError("El centro de costo no existe");
}

function rethrowDuplicate(err: unknown, name: string): never {
  if (isUniqueConstraintError(err)) throw new ConflictError(`Ya existe la sala ${name} en ese centro de costo`, { field: "name" });
  throw err;
}

export async function createRoom(input: CommRoomInput, userId: number): Promise<CommRoom> {
  await assertCostCenter(input.costCenterId);
  try {
    const [row] = await postgres.query<{ id: number }>(
      `INSERT INTO comm_rooms (name, cost_center_id, address, is_active, created_by)
       VALUES (:name, :costCenterId, :address, :isActive, :userId) RETURNING id`,
      {
        replacements: { name: input.name, costCenterId: input.costCenterId, address: input.address, isActive: input.isActive ?? true, userId },
        type: QueryTypes.SELECT,
      },
    );
    return getRoomOrThrow(row!.id);
  } catch (err) {
    rethrowDuplicate(err, input.name);
  }
}

export async function updateRoom(id: number, input: CommRoomInput, userId: number): Promise<CommRoom> {
  await assertCostCenter(input.costCenterId);
  try {
    await postgres.transaction(async (transaction) => {
      const [current] = await postgres.query<{ isActive: boolean }>(
        `SELECT is_active AS "isActive" FROM comm_rooms WHERE id = :id FOR UPDATE`,
        { replacements: { id }, type: QueryTypes.SELECT, transaction },
      );
      if (!current) throw new NotFoundError(`La sala ${id} no existe`);
      // Desactivar no revoca en silencio: quien tiene acceso se revoca a la vista, con motivo.
      if (current.isActive && input.isActive === false) {
        const [active] = await postgres.query<{ total: number }>(
          `SELECT COUNT(*)::int AS total FROM comm_room_access_grants WHERE room_id = :id AND status = 'ACTIVE'`,
          { replacements: { id }, type: QueryTypes.SELECT, transaction },
        );
        if ((active?.total ?? 0) > 0) {
          throw new ConflictError(`La sala tiene ${active!.total} acceso(s) activo(s): revóquelos antes de desactivarla`);
        }
      }
      await postgres.query(
        `UPDATE comm_rooms SET name = :name, cost_center_id = :costCenterId, address = :address,
                is_active = :isActive, updated_by = :userId, updated_at = now()
          WHERE id = :id`,
        {
          replacements: { id, name: input.name, costCenterId: input.costCenterId, address: input.address, isActive: input.isActive ?? current.isActive, userId },
          transaction,
        },
      );
    });
  } catch (err) {
    rethrowDuplicate(err, input.name);
  }
  return getRoomOrThrow(id);
}

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------
export interface CommRoomSettings {
  temporaryMaxActiveDays: number;
  updatedAt: Date;
}

export async function getSettings(transaction?: Transaction): Promise<CommRoomSettings> {
  const [row] = await postgres.query<CommRoomSettings>(
    `SELECT temporary_max_active_days AS "temporaryMaxActiveDays", updated_at AS "updatedAt" FROM comm_room_settings WHERE id = 1`,
    { type: QueryTypes.SELECT, transaction },
  );
  return row ?? { temporaryMaxActiveDays: 30, updatedAt: new Date(0) };
}

export async function updateSettings(input: { temporaryMaxActiveDays: number }, userId: number): Promise<CommRoomSettings> {
  await postgres.query(
    `INSERT INTO comm_room_settings (id, temporary_max_active_days, updated_by, updated_at) VALUES (1, :days, :userId, now())
     ON CONFLICT (id) DO UPDATE SET temporary_max_active_days = :days, updated_by = :userId, updated_at = now()`,
    { replacements: { days: input.temporaryMaxActiveDays, userId } },
  );
  return getSettings();
}
