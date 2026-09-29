import { QueryTypes } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { redis } from "../../../databases/redis/connection";
import { logger } from "../../../library/logger";
import { addRoomAccessTicketEvent } from "./roomAccess.service";

// Expiracion automatica de los accesos a salas (plan 016). Cada minuto marca EXPIRED los accesos
// activos cuyo periodo termino; el ingreso no depende de este barrido (se valida con now()), esto
// deja el estado al dia para los listados y la linea de tiempo del ticket. Mismo patron que el
// barrido del SLA: lease en Redis para que trabaje una replica por vuelta y lotes con SKIP LOCKED.

const SWEEP_INTERVAL_MS = 60_000;
const LEASE_KEY = "comm-rooms:access-sweeper";
const LEASE_MS = 55_000;
const BATCH = 200;

let timer: NodeJS.Timeout | null = null;
let running = false;

// Devuelve cuantos accesos expiro (lo usan las pruebas).
export async function sweepExpiredRoomAccesses(): Promise<number> {
  let total = 0;
  for (;;) {
    const expired = await postgres.transaction(async (transaction) => {
      const rows = await postgres.query<{ id: number; ticketId: number }>(
        `UPDATE comm_room_access_grants SET status = 'EXPIRED', expired_at = now()
          WHERE id IN (SELECT id FROM comm_room_access_grants
                        WHERE status = 'ACTIVE' AND valid_until IS NOT NULL AND valid_until <= now()
                        ORDER BY valid_until LIMIT :batch FOR UPDATE SKIP LOCKED)
         RETURNING id, ticket_id AS "ticketId"`,
        { replacements: { batch: BATCH }, type: QueryTypes.SELECT, transaction },
      );
      for (const row of rows) {
        await addRoomAccessTicketEvent(transaction, row.ticketId, "ROOM_ACCESS_EXPIRED", null, "El acceso a la sala expiró", {
          grantId: row.id,
        });
      }
      return rows.length;
    });
    total += expired;
    if (expired < BATCH) return total;
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const acquired = await redis.set(LEASE_KEY, String(process.pid), { NX: true, PX: LEASE_MS });
    if (acquired !== "OK") return;
    const expired = await sweepExpiredRoomAccesses();
    if (expired > 0) logger.info({ expired }, "Accesos a salas expirados");
  } catch (err) {
    logger.error({ err }, "Fallo el barrido de expiracion de accesos a salas");
  } finally {
    running = false;
  }
}

export function startRoomAccessSweeper(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), SWEEP_INTERVAL_MS);
  timer.unref();
  void tick();
}

export function stopRoomAccessSweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
