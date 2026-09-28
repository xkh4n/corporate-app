import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";

export type ServiceDeskPrefix = "INC" | "REQ" | "PRB" | "CHG" | "KB";

// Codigo del folio cuando el registro nace sin grupo.
export const NO_GROUP_CODE = "00";

// Folio sin guiones: prefijo + anio + codigo del grupo que lo recibe al crearse
// (01, 02...; 00 sin grupo) + correlativo de 6 digitos comun por prefijo y anio.
// REQ202601000001 = primera solicitud de 2026, recibida por el grupo 01. KB no
// tiene grupo: KB2026000001. El codigo queda fijo aunque despues se escale a
// otro grupo: el numero ya se le comunico al solicitante.
// El upsert con RETURNING es el incremento atomico (mismo criterio que
// inventory_count_counters) y va dentro de la transaccion del alta: si el alta
// se revierte, el numero no se pierde.
export async function nextServiceDeskNumber(
  prefix: ServiceDeskPrefix,
  transaction: Transaction,
  groupId: number | null = null,
): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await postgres.query<{ seq: number }>(
    `INSERT INTO service_desk_counters (prefix, year, next_seq) VALUES (:prefix, :year, 2)
     ON CONFLICT (prefix, year) DO UPDATE SET next_seq = service_desk_counters.next_seq + 1
     RETURNING next_seq - 1 AS seq`,
    { replacements: { prefix, year }, type: QueryTypes.SELECT, transaction },
  );
  const groupCode = prefix === "KB" ? "" : await groupCodeOf(groupId, transaction);
  return `${prefix}${year}${groupCode}${String(row!.seq).padStart(6, "0")}`;
}

async function groupCodeOf(groupId: number | null, transaction: Transaction): Promise<string> {
  if (groupId === null) return NO_GROUP_CODE;
  const [group] = await postgres.query<{ code: string | null }>(`SELECT code FROM support_groups WHERE id = :groupId`, {
    replacements: { groupId },
    type: QueryTypes.SELECT,
    transaction,
  });
  return group?.code ?? NO_GROUP_CODE;
}
