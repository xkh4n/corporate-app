import { QueryTypes } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { redis } from "../../../databases/redis/connection";
import { logger } from "../../../library/logger";
import { emailUsersAbout, fireAndForget, notifyGroup, pushTo } from "./notifications";
import { autoCloseTicket } from "./ticket.service";

// Barrido del SLA del Service Desk (plan 009). Cada minuto: marca el aviso al
// 75 % del plazo, los incumplimientos de respuesta y de resolucion, y cierra
// los RESUELTOS sin respuesta del solicitante. Con 3 replicas, un lease en
// Redis (SET NX PX) deja trabajar a una sola por vuelta; aun asi cada marca
// es un UPDATE ... WHERE <flag sin marcar> RETURNING, asi que dos barridos
// simultaneos nunca avisan dos veces lo mismo.

const SWEEP_INTERVAL_MS = 60_000;
const LEASE_KEY = "service-desk:sla-sweeper";
const LEASE_MS = 55_000;
const BATCH = 200;

let timer: NodeJS.Timeout | null = null;
let running = false;

interface Flagged {
  id: number;
  number: string;
  title: string;
  assigneeUserId: number | null;
  assignedGroupId: number | null;
}

const FLAGGED_COLUMNS = `id, number, title, assignee_user_id AS "assigneeUserId", assigned_group_id AS "assignedGroupId"`;

async function flag(sql: string): Promise<Flagged[]> {
  return postgres.query<Flagged>(sql, { replacements: { batch: BATCH }, type: QueryTypes.SELECT });
}

async function recordEvents(tickets: Flagged[], eventType: string, payload: Record<string, unknown>): Promise<void> {
  for (const ticket of tickets) {
    await postgres.query(
      `INSERT INTO service_ticket_events (ticket_id, event_type, is_public, payload) VALUES (:id, :eventType, false, CAST(:payload AS JSONB))`,
      { replacements: { id: ticket.id, eventType, payload: JSON.stringify(payload) } },
    );
  }
}

function alert(tickets: Flagged[], reason: "sla-warning" | "sla-breached", subject: string, body: string): void {
  for (const ticket of tickets) {
    const record = { id: ticket.id, number: ticket.number, title: ticket.title };
    if (ticket.assigneeUserId) {
      pushTo([ticket.assigneeUserId], reason, record);
      fireAndForget(() => emailUsersAbout([ticket.assigneeUserId], record, subject, body));
    }
    fireAndForget(() => notifyGroup(ticket.assignedGroupId, reason, record, subject, body));
  }
}

export async function sweepServiceDeskSla(): Promise<void> {
  // Aviso: 75 % del plazo de resolucion consumido.
  const warned = await flag(
    `UPDATE service_tickets SET warned_at = now()
      WHERE id IN (SELECT id FROM service_tickets
                    WHERE status IN ('NEW','ASSIGNED','IN_PROGRESS') AND warned_at IS NULL AND NOT resolution_breached
                      AND resolution_warn_at < now() AND resolution_due_at > now()
                    ORDER BY resolution_warn_at LIMIT :batch FOR UPDATE SKIP LOCKED)
     RETURNING ${FLAGGED_COLUMNS}`,
  );
  await recordEvents(warned, "SLA_WARNING", { kind: "resolution" });
  alert(warned, "sla-warning", "SLA en riesgo", "El ticket consumió el 75 % de su plazo de resolución.");

  const responseBreached = await flag(
    `UPDATE service_tickets SET response_breached = true
      WHERE id IN (SELECT id FROM service_tickets
                    WHERE status IN ('NEW','ASSIGNED','IN_PROGRESS','ON_HOLD') AND first_response_at IS NULL
                      AND NOT response_breached AND response_due_at < now()
                    ORDER BY response_due_at LIMIT :batch FOR UPDATE SKIP LOCKED)
     RETURNING ${FLAGGED_COLUMNS}`,
  );
  await recordEvents(responseBreached, "SLA_BREACHED", { kind: "response" });
  alert(responseBreached, "sla-breached", "SLA de respuesta incumplido", "El ticket no tuvo primera respuesta dentro del plazo.");

  const resolutionBreached = await flag(
    `UPDATE service_tickets SET resolution_breached = true
      WHERE id IN (SELECT id FROM service_tickets
                    WHERE status IN ('NEW','ASSIGNED','IN_PROGRESS') AND NOT resolution_breached AND resolution_due_at < now()
                    ORDER BY resolution_due_at LIMIT :batch FOR UPDATE SKIP LOCKED)
     RETURNING ${FLAGGED_COLUMNS}`,
  );
  await recordEvents(resolutionBreached, "SLA_BREACHED", { kind: "resolution" });
  alert(resolutionBreached, "sla-breached", "SLA de resolución incumplido", "El ticket superó su plazo de resolución.");

  const toClose = await postgres.query<{ id: number }>(
    `SELECT id FROM service_tickets WHERE status = 'RESOLVED' AND auto_close_at < now() ORDER BY auto_close_at LIMIT :batch`,
    { replacements: { batch: BATCH }, type: QueryTypes.SELECT },
  );
  for (const { id } of toClose) {
    try {
      await autoCloseTicket(id);
    } catch (err) {
      logger.error({ err, ticketId: id }, "Service Desk: no se pudo cerrar automaticamente el ticket");
    }
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const acquired = await redis.set(LEASE_KEY, String(process.pid), { NX: true, PX: LEASE_MS });
    if (acquired !== "OK") return;
    await sweepServiceDeskSla();
  } catch (err) {
    logger.error({ err }, "Fallo el barrido de SLA del Service Desk");
  } finally {
    running = false;
  }
}

export function startServiceDeskSlaSweeper(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), SWEEP_INTERVAL_MS);
  timer.unref();
  void tick();
}

export function stopServiceDeskSlaSweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
