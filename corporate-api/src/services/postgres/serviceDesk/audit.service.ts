import { QueryTypes } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import type { PaginationParams } from "../../../library/pagination";
import { getOffset } from "../../../library/pagination";
import { getUserDirectory } from "../../mssql/user.service";

// Auditoria de la configuracion del Service Desk (auditoria de seguridad run-3,
// F6): grupos y miembros, categorias, catalogo, calendario, matriz, SLA y
// plantillas de cambio estandar cambian quien ve, aprueba y atiende. Cada cambio
// confirmado deja una fila insert-only con quien, que y los datos enviados.

export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "REPLACE";

export interface SettingsAuditEntry {
  entity: string;
  entityId: number | null;
  action: AuditAction;
  actorUserId: number;
  payload: unknown;
}

export interface SettingsAuditRecord {
  id: number;
  entity: string;
  entityId: number | null;
  action: AuditAction;
  actorUserId: number;
  actorName: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export async function recordSettingsChange(entry: SettingsAuditEntry): Promise<void> {
  await postgres.query(
    `INSERT INTO service_desk_audit_log (entity, entity_id, action, actor_user_id, payload)
     VALUES (:entity, :entityId, :action, :actorUserId, CAST(:payload AS JSONB))`,
    {
      replacements: {
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        actorUserId: entry.actorUserId,
        payload: JSON.stringify(entry.payload ?? {}),
      },
    },
  );
}

export async function listSettingsAudit(
  params: PaginationParams,
  filters: { entity?: string },
): Promise<{ items: SettingsAuditRecord[]; total: number }> {
  const where = filters.entity ? "WHERE entity = :entity" : "";
  const replacements = { entity: filters.entity ?? null };
  const [count] = await postgres.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM service_desk_audit_log ${where}`, {
    replacements,
    type: QueryTypes.SELECT,
  });
  const rows = await postgres.query<Omit<SettingsAuditRecord, "actorName">>(
    `SELECT id::int AS id, entity, entity_id AS "entityId", action, actor_user_id AS "actorUserId", payload, created_at AS "createdAt"
       FROM service_desk_audit_log ${where} ORDER BY id DESC LIMIT :limit OFFSET :offset`,
    { replacements: { ...replacements, limit: params.limit, offset: getOffset(params) }, type: QueryTypes.SELECT },
  );
  const directory = await getUserDirectory(rows.map((row) => row.actorUserId));
  return {
    items: rows.map((row) => ({ ...row, actorName: directory.get(row.actorUserId)?.fullName ?? null })),
    total: count?.total ?? 0,
  };
}
