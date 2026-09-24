import { QueryTypes } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";

// Indicadores del Service Desk (plan 009, fase 9E), sobre los tickets creados
// en los ultimos N dias (la cola abierta se cuenta completa).

export interface ServiceDeskSummary {
  days: number;
  backlogByStatus: { status: string; total: number }[];
  backlogByGroup: { groupName: string; total: number; breached: number }[];
  created: number;
  resolved: number;
  // % de tickets resueltos en el periodo que cumplieron el SLA de resolucion.
  slaCompliance: number | null;
  // % con la primera respuesta a tiempo.
  responseCompliance: number | null;
  // Tiempo medio de resolucion en horas corridas (creacion -> resolucion).
  mttrHours: number | null;
  // % resueltos sin escalar de grupo ni reabrir.
  firstContactResolution: number | null;
  reopenRate: number | null;
  csatAverage: number | null;
  csatResponses: number;
  topCategories: { name: string; total: number }[];
  topAssets: { assetId: number; tag: string; incidents: number }[];
  byPriority: { priority: string; total: number }[];
}

const round1 = (value: number | null | undefined) => (value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10);

export async function getSummary(days: number): Promise<ServiceDeskSummary> {
  const replacements = { days };
  const backlogByStatus = await postgres.query<{ status: string; total: number }>(
    `SELECT status, COUNT(*)::int AS total FROM service_tickets
      WHERE status NOT IN ('CLOSED','CANCELLED') GROUP BY status ORDER BY status`,
    { type: QueryTypes.SELECT },
  );
  const backlogByGroup = await postgres.query<{ groupName: string; total: number; breached: number }>(
    `SELECT COALESCE(g.name, 'Sin grupo') AS "groupName", COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE t.resolution_breached OR (t.status IN ('NEW','ASSIGNED','IN_PROGRESS') AND t.resolution_due_at < now()))::int AS breached
       FROM service_tickets t LEFT JOIN support_groups g ON g.id = t.assigned_group_id
      WHERE t.status IN ('NEW','ASSIGNED','IN_PROGRESS','ON_HOLD')
      GROUP BY g.name ORDER BY total DESC`,
    { type: QueryTypes.SELECT },
  );
  const [stats] = await postgres.query<{
    created: number;
    resolved: number;
    slaCompliance: number | null;
    responseCompliance: number | null;
    mttrHours: number | null;
    fcr: number | null;
    reopenRate: number | null;
    csatAverage: number | null;
    csatResponses: number;
  }>(
    `WITH period AS (SELECT * FROM service_tickets WHERE created_at > now() - make_interval(days => :days)),
          done AS (SELECT * FROM period WHERE resolved_at IS NOT NULL)
     SELECT (SELECT COUNT(*)::int FROM period) AS created,
            (SELECT COUNT(*)::int FROM done) AS resolved,
            (SELECT 100.0 * COUNT(*) FILTER (WHERE NOT resolution_breached) / NULLIF(COUNT(*), 0) FROM done) AS "slaCompliance",
            (SELECT 100.0 * COUNT(*) FILTER (WHERE NOT response_breached) / NULLIF(COUNT(*), 0)
               FROM period WHERE first_response_at IS NOT NULL) AS "responseCompliance",
            (SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) FROM done) AS "mttrHours",
            (SELECT 100.0 * COUNT(*) FILTER (WHERE reopen_count = 0 AND NOT EXISTS (
                      SELECT 1 FROM service_ticket_events e WHERE e.ticket_id = done.id AND e.event_type = 'ESCALATED'))
                    / NULLIF(COUNT(*), 0) FROM done) AS fcr,
            (SELECT 100.0 * COUNT(*) FILTER (WHERE reopen_count > 0) / NULLIF(COUNT(*), 0) FROM done) AS "reopenRate",
            (SELECT AVG(csat_score) FROM period WHERE csat_score IS NOT NULL) AS "csatAverage",
            (SELECT COUNT(*)::int FROM period WHERE csat_score IS NOT NULL) AS "csatResponses"`,
    { replacements, type: QueryTypes.SELECT },
  );
  const topCategories = await postgres.query<{ name: string; total: number }>(
    `SELECT COALESCE(c.name, 'Sin categoría') AS name, COUNT(*)::int AS total
       FROM service_tickets t LEFT JOIN service_categories c ON c.id = t.category_id
      WHERE t.created_at > now() - make_interval(days => :days)
      GROUP BY c.name ORDER BY total DESC LIMIT 8`,
    { replacements, type: QueryTypes.SELECT },
  );
  const topAssets = await postgres.query<{ assetId: number; tag: string; incidents: number }>(
    `SELECT a.id AS "assetId", a.tag, COUNT(*)::int AS incidents
       FROM service_ticket_assets l JOIN service_tickets t ON t.id = l.ticket_id JOIN assets a ON a.id = l.asset_id
      WHERE t.type = 'INCIDENT' AND t.created_at > now() - make_interval(days => :days)
      GROUP BY a.id ORDER BY incidents DESC, a.tag LIMIT 10`,
    { replacements, type: QueryTypes.SELECT },
  );
  const byPriority = await postgres.query<{ priority: string; total: number }>(
    `SELECT priority, COUNT(*)::int AS total FROM service_tickets
      WHERE created_at > now() - make_interval(days => :days) GROUP BY priority ORDER BY priority`,
    { replacements, type: QueryTypes.SELECT },
  );

  return {
    days,
    backlogByStatus,
    backlogByGroup,
    created: stats?.created ?? 0,
    resolved: stats?.resolved ?? 0,
    slaCompliance: round1(stats?.slaCompliance),
    responseCompliance: round1(stats?.responseCompliance),
    mttrHours: round1(stats?.mttrHours),
    firstContactResolution: round1(stats?.fcr),
    reopenRate: round1(stats?.reopenRate),
    csatAverage: round1(stats?.csatAverage),
    csatResponses: stats?.csatResponses ?? 0,
    topCategories,
    topAssets,
    byPriority,
  };
}
