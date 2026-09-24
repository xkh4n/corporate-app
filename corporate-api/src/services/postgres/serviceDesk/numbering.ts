import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";

export type ServiceDeskPrefix = "INC" | "REQ" | "PRB" | "CHG" | "KB";

// Folio legible por prefijo y anio: INC-2026-000001. El upsert con RETURNING
// es el incremento atomico (mismo criterio que inventory_count_counters) y va
// dentro de la transaccion del alta: si el alta se revierte, el numero no se pierde.
export async function nextServiceDeskNumber(prefix: ServiceDeskPrefix, transaction: Transaction): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await postgres.query<{ seq: number }>(
    `INSERT INTO service_desk_counters (prefix, year, next_seq) VALUES (:prefix, :year, 2)
     ON CONFLICT (prefix, year) DO UPDATE SET next_seq = service_desk_counters.next_seq + 1
     RETURNING next_seq - 1 AS seq`,
    { replacements: { prefix, year }, type: QueryTypes.SELECT, transaction },
  );
  return `${prefix}-${year}-${String(row!.seq).padStart(6, "0")}`;
}
