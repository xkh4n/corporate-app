import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { NotFoundError } from "../../../library/errors";
import { hasPermission } from "../permission.service";

// Alcance del agente sobre los tickets (plan 009, auditoria run-3): cada
// agente ve y trabaja solo los tickets de los grupos de soporte activos a los
// que pertenece. Ver todo (el Jefe de Soporte TI) es un permiso explicito,
// service-tickets:all_view, que asigna el admin; la membresia en grupos nunca
// lo otorga. El admin ve todo. Un ticket fuera del alcance responde 404.
// Quien aprueba solicitudes del catalogo ademas las lee (solo lo publico)
// mientras esperan su aprobacion.

export interface ScopeActor {
  userId: number;
  isAdmin?: boolean;
  roleId?: number;
}

export interface TicketScope {
  all: boolean;
  userId: number;
  groupIds: number[];
}

interface ScopedTicket {
  assignedGroupId: number | null;
  status?: string;
  approvalGroupId?: number | null;
}

export async function resolveTicketScope(actor: ScopeActor, transaction?: Transaction): Promise<TicketScope> {
  const all = Boolean(actor.isAdmin) || (actor.roleId !== undefined && (await hasPermission(actor.roleId, "service-tickets", "all_view")));
  if (all) return { all: true, userId: actor.userId, groupIds: [] };
  const rows = await postgres.query<{ groupId: number }>(
    `SELECT m.group_id AS "groupId" FROM support_group_members m JOIN support_groups g ON g.id = m.group_id
      WHERE m.user_id = :userId AND g.is_active`,
    { replacements: { userId: actor.userId }, type: QueryTypes.SELECT, transaction },
  );
  return { all: false, userId: actor.userId, groupIds: rows.map((row) => row.groupId) };
}

// Condicion SQL sobre el alias `t` (service_tickets). withApprovals: tambien las
// solicitudes pendientes que el agente puede aprobar (grupo aprobador fijado en el ticket).
export function ticketScopeCondition(
  scope: TicketScope,
  replacements: Record<string, unknown>,
  options: { withApprovals?: boolean } = {},
): string | null {
  if (scope.all) return null;
  // IN () vacio no es SQL valido: 0 no es id de ningun grupo.
  replacements.scopeGroupIds = scope.groupIds.length > 0 ? scope.groupIds : [0];
  return `(t.assigned_group_id IN (:scopeGroupIds)${
    options.withApprovals ? " OR (t.status = 'PENDING_APPROVAL' AND t.approval_group_id IN (:scopeGroupIds))" : ""
  })`;
}

// Alcance de trabajo: el ticket esta en un grupo del agente (o el agente ve todo).
export function isTicketInScope(scope: TicketScope, row: ScopedTicket): boolean {
  return scope.all || (row.assignedGroupId !== null && scope.groupIds.includes(row.assignedGroupId));
}

// Lectura como aprobador: solicitud pendiente de un grupo aprobador del agente.
export function isPendingApprovalFor(scope: TicketScope, row: ScopedTicket): boolean {
  return row.status === "PENDING_APPROVAL" && !!row.approvalGroupId && scope.groupIds.includes(row.approvalGroupId);
}

export function assertTicketInScope(
  scope: TicketScope,
  row: ScopedTicket & { id: number },
  options: { withApprovals?: boolean } = {},
): void {
  if (isTicketInScope(scope, row)) return;
  if (options.withApprovals && isPendingApprovalFor(scope, row)) return;
  throw new NotFoundError(`El ticket ${row.id} no existe`);
}

// Un lote de tickets (vinculos desde problemas, cambios o KB): todos deben estar
// en el alcance. Los inexistentes los informa el servicio que vincula.
export async function assertTicketsInScope(ticketIds: number[], scope: TicketScope): Promise<void> {
  if (scope.all || ticketIds.length === 0) return;
  const rows = await postgres.query<{ id: number; assignedGroupId: number | null }>(
    `SELECT id, assigned_group_id AS "assignedGroupId" FROM service_tickets WHERE id IN (:ids)`,
    { replacements: { ids: [...new Set(ticketIds)] }, type: QueryTypes.SELECT },
  );
  for (const row of rows) assertTicketInScope(scope, row);
}

// Tickets listados dentro de otro registro (incidentes de un problema, tickets de un cambio).
export function filterTicketsInScope<T extends ScopedTicket>(items: T[], scope: TicketScope): T[] {
  return scope.all ? items : items.filter((item) => isTicketInScope(scope, item));
}
