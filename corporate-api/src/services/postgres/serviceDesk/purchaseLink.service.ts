import { QueryTypes } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { logger } from "../../../library/logger";
import { onPurchaseRequestStatusChanged } from "../../../library/purchaseRequestEvents";
import { getPurchaseRequestStatuses } from "../../mssql/purchaseRequest.service";
import { applyPurchaseRequestState } from "./ticket.service";

// Solicitud de equipo (plan 010): la compra mueve el ticket que la genero.
// Dos caminos que aplican lo mismo (applyPurchaseRequestState es idempotente):
// el aviso inmediato al cambiar el estado de la compra y el barrido del SLA,
// que recupera lo que el aviso no alcanzo a aplicar (replica caida, Postgres
// sin conexion en ese momento).

const RECONCILE_BATCH = 200;

export async function syncTicketForPurchaseRequest(requestId: number): Promise<boolean> {
  const [ticket] = await postgres.query<{ id: number }>(`SELECT id FROM service_tickets WHERE purchase_request_id = :requestId`, {
    replacements: { requestId },
    type: QueryTypes.SELECT,
  });
  if (!ticket) return false;
  const state = (await getPurchaseRequestStatuses([requestId])).get(requestId);
  if (!state) return false;
  return applyPurchaseRequestState(ticket.id, state);
}

// Tickets vivos con compra vinculada cuyo estado de compra quedo atrasado.
export async function reconcilePurchaseLinkedTickets(): Promise<number> {
  const tickets = await postgres.query<{ id: number; purchaseRequestId: number; purchaseRequestStatus: string | null }>(
    `SELECT id, purchase_request_id AS "purchaseRequestId", purchase_request_status AS "purchaseRequestStatus"
       FROM service_tickets
      WHERE purchase_request_id IS NOT NULL AND status NOT IN ('CLOSED','CANCELLED')
      ORDER BY updated_at LIMIT :batch`,
    { replacements: { batch: RECONCILE_BATCH }, type: QueryTypes.SELECT },
  );
  if (tickets.length === 0) return 0;
  const states = await getPurchaseRequestStatuses(tickets.map((ticket) => ticket.purchaseRequestId));
  let applied = 0;
  for (const ticket of tickets) {
    const state = states.get(ticket.purchaseRequestId);
    if (!state || state.status === ticket.purchaseRequestStatus) continue;
    try {
      if (await applyPurchaseRequestState(ticket.id, state)) applied++;
    } catch (err) {
      logger.error({ err, ticketId: ticket.id }, "Service Desk: no se pudo sincronizar el ticket con su solicitud de compra");
    }
  }
  return applied;
}

// Se llama una vez al arrancar la API, en cada replica: el cambio de estado
// puede ocurrir en cualquiera.
export function registerPurchaseTicketSync(): void {
  onPurchaseRequestStatusChanged(async (requestId) => {
    await syncTicketForPurchaseRequest(requestId);
  });
}
