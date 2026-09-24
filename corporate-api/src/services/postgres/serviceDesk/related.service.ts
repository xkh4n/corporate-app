import { QueryTypes } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { NotFoundError } from "../../../library/errors";
import { searchPublished } from "./kb.service";
import { assertTicketInScope, ticketScopeCondition, type TicketScope } from "./ticketScope";

// "Gestion relacionada" del ticket (plan 009): su problema, los cambios que
// lo tocan, los articulos de conocimiento vinculados o sugeridos y los otros
// tickets de los mismos activos. Solo lectura, para el panel del agente.

export interface TicketRelated {
  problem: { id: number; number: string; title: string; status: string; workaround: string | null } | null;
  changes: { id: number; number: string; title: string; status: string; plannedStart: Date | null }[];
  kbArticles: { id: number; number: string; title: string; usedToResolve: boolean }[];
  suggestedArticles: { id: number; number: string; title: string; snippet: string }[];
  sameAssetTickets: { id: number; number: string; title: string; status: string; type: string; createdAt: Date; tags: string[] }[];
}

// scope: alcance del agente; el ticket debe estar en sus grupos y los otros
// tickets del mismo activo se acotan igual.
export async function getTicketRelated(ticketId: number, scope: TicketScope): Promise<TicketRelated> {
  const [ticket] = await postgres.query<{
    id: number;
    problemId: number | null;
    title: string;
    assignedGroupId: number | null;
    status: string;
    approvalGroupId: number | null;
  }>(
    `SELECT t.id, t.problem_id AS "problemId", t.title, t.assigned_group_id AS "assignedGroupId", t.status,
            t.approval_group_id AS "approvalGroupId"
       FROM service_tickets t WHERE t.id = :ticketId`,
    { replacements: { ticketId }, type: QueryTypes.SELECT },
  );
  if (!ticket) throw new NotFoundError(`El ticket ${ticketId} no existe`);
  assertTicketInScope(scope, ticket, { withApprovals: true });
  const sameAssetReplacements: Record<string, unknown> = { ticketId };
  const scopeCondition = ticketScopeCondition(scope, sameAssetReplacements);

  const [problem] = ticket.problemId
    ? await postgres.query<NonNullable<TicketRelated["problem"]>>(
        `SELECT id, number, title, status, workaround FROM service_problems WHERE id = :id`,
        { replacements: { id: ticket.problemId }, type: QueryTypes.SELECT },
      )
    : [];

  // Cambios vinculados al ticket o a alguno de sus activos (vivos).
  const changes = await postgres.query<TicketRelated["changes"][number]>(
    `SELECT DISTINCT c.id, c.number, c.title, c.status, c.planned_start AS "plannedStart"
       FROM service_changes c
      WHERE c.id IN (SELECT change_id FROM service_change_tickets WHERE ticket_id = :ticketId)
         OR (c.status NOT IN ('CLOSED','REJECTED','CANCELLED') AND c.id IN (
              SELECT ca.change_id FROM service_change_assets ca
                JOIN service_ticket_assets ta ON ta.asset_id = ca.asset_id WHERE ta.ticket_id = :ticketId))
      ORDER BY c.id DESC LIMIT 20`,
    { replacements: { ticketId }, type: QueryTypes.SELECT },
  );

  const kbArticles = await postgres.query<TicketRelated["kbArticles"][number]>(
    `SELECT k.id, k.number, k.title, l.used_to_resolve AS "usedToResolve"
       FROM service_ticket_kb l JOIN kb_articles k ON k.id = l.article_id WHERE l.ticket_id = :ticketId ORDER BY k.id`,
    { replacements: { ticketId }, type: QueryTypes.SELECT },
  );

  // Sugerencias por el titulo del ticket (el agente ve tambien los internos).
  const suggestions = await searchPublished(ticket.title, { audience: "INTERNAL", limit: 5, anyTerm: true });
  const linkedIds = new Set(kbArticles.map((article) => article.id));

  const sameAssetTickets = await postgres.query<TicketRelated["sameAssetTickets"][number]>(
    `SELECT t.id, t.number, t.title, t.status, t.type, t.created_at AS "createdAt",
            array_agg(DISTINCT a.tag ORDER BY a.tag) AS tags
       FROM service_ticket_assets mine
       JOIN service_ticket_assets other ON other.asset_id = mine.asset_id AND other.ticket_id <> mine.ticket_id
       JOIN service_tickets t ON t.id = other.ticket_id
       JOIN assets a ON a.id = other.asset_id
      WHERE mine.ticket_id = :ticketId ${scopeCondition ? `AND ${scopeCondition}` : ""}
      GROUP BY t.id
      ORDER BY t.created_at DESC LIMIT 20`,
    { replacements: sameAssetReplacements, type: QueryTypes.SELECT },
  );

  return {
    problem: problem ?? null,
    changes,
    kbArticles,
    suggestedArticles: suggestions
      .filter((article) => !linkedIds.has(article.id))
      .map(({ id, number, title, snippet }) => ({ id, number, title, snippet })),
    sameAssetTickets,
  };
}
