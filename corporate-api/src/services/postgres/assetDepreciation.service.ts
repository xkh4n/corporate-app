import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { BadRequestError, ConflictError, NotFoundError } from "../../library/errors";
import {
  addMonths,
  currentPeriod,
  isValidPeriod,
  monthlyInstallment,
  monthsBetween,
  type DepreciationMethod,
} from "../../library/depreciation";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { recordAccountingEntry } from "./assetKardex.service";

// Cierre mensual de depreciacion (plan 007). Reglas:
// - En orden: el periodo a cerrar es el siguiente al ultimo CLOSED o, si no
//   hay ninguno, el primer mes de inicio entre los activos a depreciar.
// - Nunca un periodo futuro (se permite el mes en curso).
// - Todo el cierre en UNA transaccion bajo un advisory lock global (las 3
//   replicas); el indice unico parcial uq_asset_depreciation_runs_closed_period
//   es la ultima barrera contra un cierre doble del mismo mes.
// - Solo se anula el ULTIMO cierre: escribe DEPRECIATION_REVERSAL por cada
//   asiento, sin borrar nada del Kardex.

const CLOSE_LOCK_KEY = "asset-depreciation-close";
// Un activo dado de baja deja de depreciarse (su saldo ya se llevo a 0).
const NOT_DEPRECIABLE_STATUS_CODES = ["DECOMMISSIONED", "DEVALUATED"];

export interface DepreciationRun {
  id: number;
  period: string;
  status: "CLOSED" | "VOIDED";
  assetCount: number;
  totalAmount: string;
  closedBy: number | null;
  closedAt: Date;
  voidedBy: number | null;
  voidedAt: Date | null;
}

export interface DepreciationLine {
  assetId: number;
  tag: string;
  amount: string;
  accumulated: string;
  bookValue: string;
}

interface Candidate {
  assetId: number;
  tag: string;
  capitalizedCost: string;
  residualValue: string;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod;
  startPeriod: string;
  accumulated: string;
}

const RUN_COLUMNS = `
  id, to_char(period, 'YYYY-MM') AS period, status, asset_count AS "assetCount",
  total_amount::text AS "totalAmount", closed_by AS "closedBy", closed_at AS "closedAt",
  voided_by AS "voidedBy", voided_at AS "voidedAt"
`;

// Depreciacion acumulada de un activo: solo cuentan los cierres CLOSED (un
// cierre anulado ya se reverso en el Kardex).
// Estados operativos de un activo que ya salio de servicio.
const DERECOGNIZED_STATUS_CODES = ["DECOMMISSIONED", "DEVALUATED"];

export const ACCUMULATED_SQL = `
  COALESCE((SELECT SUM(e.amount) FROM asset_depreciation_entries e
              JOIN asset_depreciation_runs r ON r.id = e.run_id AND r.status = 'CLOSED'
             WHERE e.asset_id = aa.asset_id), 0)
`;

function toDate(period: string): string {
  return `${period}-01`;
}

async function lockCloses(transaction: Transaction): Promise<void> {
  await postgres.query(`SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))`, {
    replacements: { key: CLOSE_LOCK_KEY },
    type: QueryTypes.SELECT,
    transaction,
  });
}

async function getLastClosed(transaction?: Transaction): Promise<DepreciationRun | null> {
  const [row] = await postgres.query<DepreciationRun>(
    `SELECT ${RUN_COLUMNS} FROM asset_depreciation_runs WHERE status = 'CLOSED' ORDER BY period DESC LIMIT 1`,
    { type: QueryTypes.SELECT, transaction },
  );
  return row ?? null;
}

// Primer periodo que todavia se puede cerrar ("YYYY-MM"), o null si no hubo
// ningun cierre (entonces el primero lo define el inicio mas temprano). Lo
// usa assetAccounting.service para no dejar fijar un inicio en un mes ya
// cerrado.
export async function getNextOpenPeriod(transaction?: Transaction): Promise<string | null> {
  const last = await getLastClosed(transaction);
  return last ? addMonths(last.period, 1) : null;
}

async function listCandidates(period: string, transaction?: Transaction): Promise<Candidate[]> {
  return postgres.query<Candidate>(
    `SELECT aa.asset_id AS "assetId", a.tag, aa.capitalized_cost::text AS "capitalizedCost",
            COALESCE(aa.residual_value, 0)::text AS "residualValue", aa.useful_life_months AS "usefulLifeMonths",
            aa.depreciation_method AS "depreciationMethod",
            to_char(aa.depreciation_start_date, 'YYYY-MM') AS "startPeriod",
            ${ACCUMULATED_SQL}::text AS accumulated
       FROM asset_accounting aa
       JOIN assets a ON a.id = aa.asset_id
       JOIN asset_statuses s ON s.id = a.status_id
      WHERE aa.stage IN ('CAPITALIZED', 'DEPRECIATING')
        AND aa.depreciation_start_date <= :period
        AND s.code NOT IN (:excluded)
      ORDER BY aa.asset_id`,
    {
      replacements: { period: toDate(period), excluded: NOT_DEPRECIABLE_STATUS_CODES },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
}

function computeLine(candidate: Candidate, period: string): { amount: number; accumulated: number; bookValue: number } {
  const params = {
    cost: Number(candidate.capitalizedCost),
    residual: Number(candidate.residualValue),
    lifeMonths: candidate.usefulLifeMonths,
    method: candidate.depreciationMethod,
  };
  const previous = Number(candidate.accumulated);
  const amount = monthlyInstallment(params, previous, monthsBetween(candidate.startPeriod, period));
  const accumulated = Math.round((previous + amount) * 100) / 100;
  return { amount, accumulated, bookValue: Math.round((params.cost - accumulated) * 100) / 100 };
}

// Que periodo toca cerrar y por que no se puede, si no se puede.
async function resolvePeriodToClose(transaction?: Transaction): Promise<{ period: string | null; reason?: string }> {
  const last = await getLastClosed(transaction);
  if (last) return { period: addMonths(last.period, 1) };
  const [first] = await postgres.query<{ period: string | null }>(
    `SELECT to_char(MIN(depreciation_start_date), 'YYYY-MM') AS period
       FROM asset_accounting WHERE stage IN ('CAPITALIZED', 'DEPRECIATING')`,
    { type: QueryTypes.SELECT, transaction },
  );
  if (!first?.period) return { period: null, reason: "No hay activos capitalizados para depreciar" };
  return { period: first.period };
}

// Vista previa del proximo cierre, sin escribir nada.
export async function previewNextClose(): Promise<{
  period: string | null;
  canClose: boolean;
  reason?: string;
  lines: DepreciationLine[];
  totalAmount: string;
}> {
  const { period, reason } = await resolvePeriodToClose();
  if (!period) return { period: null, canClose: false, reason, lines: [], totalAmount: "0.00" };

  const lines = (await listCandidates(period))
    .map((candidate) => ({ candidate, line: computeLine(candidate, period) }))
    .filter(({ line }) => line.amount > 0)
    .map(({ candidate, line }) => ({
      assetId: candidate.assetId,
      tag: candidate.tag,
      amount: line.amount.toFixed(2),
      accumulated: line.accumulated.toFixed(2),
      bookValue: line.bookValue.toFixed(2),
    }));
  const total = lines.reduce((sum, line) => sum + Math.round(Number(line.amount) * 100), 0) / 100;
  const isFuture = monthsBetween(currentPeriod(), period) > 0;
  return {
    period,
    canClose: !isFuture,
    reason: isFuture ? `El periodo ${period} todavia no comienza` : undefined,
    lines,
    totalAmount: total.toFixed(2),
  };
}

export async function closePeriod(period: string, userId: number): Promise<DepreciationRun> {
  if (!isValidPeriod(period)) throw new BadRequestError("El periodo debe tener el formato AAAA-MM");
  if (monthsBetween(currentPeriod(), period) > 0) {
    throw new BadRequestError(`No se puede cerrar un periodo futuro (${period})`);
  }

  return postgres.transaction(async (transaction) => {
    await lockCloses(transaction);
    const expected = await resolvePeriodToClose(transaction);
    if (!expected.period) throw new ConflictError(expected.reason ?? "No hay periodo para cerrar");
    if (expected.period !== period) {
      throw new ConflictError(`Los cierres van en orden: el proximo periodo a cerrar es ${expected.period}`);
    }

    const [run] = await postgres.query<{ id: number }>(
      `INSERT INTO asset_depreciation_runs (period, status, closed_by) VALUES (:period, 'CLOSED', :userId) RETURNING id`,
      { replacements: { period: toDate(period), userId }, type: QueryTypes.SELECT, transaction },
    );
    if (!run) throw new Error("INSERT de cierre de depreciacion sin RETURNING");

    let assetCount = 0;
    let totalCents = 0;
    for (const candidate of await listCandidates(period, transaction)) {
      const line = computeLine(candidate, period);
      if (line.amount <= 0) continue;
      await recordAccountingEntry(
        {
          assetId: candidate.assetId,
          entryType: "DEPRECIATION",
          amount: -line.amount,
          reference: `DEP-${period}`,
          notes: `Depreciacion ${period}`,
          createdBy: userId,
        },
        transaction,
      );
      await postgres.query(
        `INSERT INTO asset_depreciation_entries (run_id, asset_id, amount, accumulated, book_value)
         VALUES (:runId, :assetId, :amount, :accumulated, :bookValue)`,
        {
          replacements: {
            runId: run.id,
            assetId: candidate.assetId,
            amount: line.amount.toFixed(2),
            accumulated: line.accumulated.toFixed(2),
            bookValue: line.bookValue.toFixed(2),
          },
          transaction,
        },
      );
      const depreciable = Number(candidate.capitalizedCost) - Number(candidate.residualValue);
      const stage = line.accumulated >= Math.round(depreciable * 100) / 100 ? "FULLY_DEPRECIATED" : "DEPRECIATING";
      await postgres.query(`UPDATE asset_accounting SET stage = :stage, updated_at = now() WHERE asset_id = :assetId`, {
        replacements: { stage, assetId: candidate.assetId },
        transaction,
      });
      assetCount += 1;
      totalCents += Math.round(line.amount * 100);
    }

    await postgres.query(
      `UPDATE asset_depreciation_runs SET asset_count = :assetCount, total_amount = :total WHERE id = :id`,
      { replacements: { assetCount, total: (totalCents / 100).toFixed(2), id: run.id }, transaction },
    );
    return getRunOrThrow(run.id, transaction);
  });
}

export async function voidRun(id: number, userId: number): Promise<DepreciationRun> {
  return postgres.transaction(async (transaction) => {
    await lockCloses(transaction);
    const run = await getRunOrThrow(id, transaction);
    if (run.status !== "CLOSED") throw new ConflictError(`El cierre ${run.period} ya esta anulado`);
    const last = await getLastClosed(transaction);
    if (!last || last.id !== run.id) {
      throw new ConflictError(`Solo se puede anular el ultimo cierre (${last?.period ?? "ninguno"})`);
    }

    // Un activo dado de baja despues del cierre (operativa, con el Kardex ya en
    // cero, o contable: WRITTEN_OFF) no se toca: la reversa le devolveria valor
    // y lo reabriria a la depreciacion -y a una segunda baja- (auditoria de
    // seguridad run-2, F2). Se bloquean los activos en orden, igual que la
    // baja contable, para que ninguna baja se cuele entre el chequeo y la reversa.
    const derecognized = await postgres.query<{ tag: string; statusCode: string; stage: string }>(
      `SELECT a.tag, s.code AS "statusCode", aa.stage
         FROM asset_depreciation_entries e
         JOIN assets a ON a.id = e.asset_id
         JOIN asset_statuses s ON s.id = a.status_id
         JOIN asset_accounting aa ON aa.asset_id = e.asset_id
        WHERE e.run_id = :id
        ORDER BY a.id
          FOR UPDATE OF a`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction },
    );
    const blocked = derecognized.filter(
      (row) => DERECOGNIZED_STATUS_CODES.includes(row.statusCode) || row.stage === "WRITTEN_OFF",
    );
    if (blocked.length > 0) {
      throw new ConflictError(
        `No se puede anular el cierre ${run.period}: hay activos dados de baja despues de cerrarlo (${blocked
          .map((row) => row.tag)
          .join(", ")})`,
      );
    }

    // Se anula el cierre ANTES de recalcular las etapas: el acumulado (que solo
    // cuenta cierres CLOSED) ya no incluye este.
    await postgres.query(
      `UPDATE asset_depreciation_runs SET status = 'VOIDED', voided_by = :userId, voided_at = now() WHERE id = :id`,
      { replacements: { userId, id }, transaction },
    );

    const entries = await postgres.query<{ assetId: number; amount: string }>(
      `SELECT asset_id AS "assetId", amount::text AS amount FROM asset_depreciation_entries WHERE run_id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction },
    );
    for (const entry of entries) {
      await recordAccountingEntry(
        {
          assetId: entry.assetId,
          entryType: "DEPRECIATION_REVERSAL",
          amount: Number(entry.amount),
          reference: `DEP-${run.period}`,
          notes: `Anulacion del cierre ${run.period}`,
          createdBy: userId,
        },
        transaction,
      );
      await postgres.query(
        `UPDATE asset_accounting aa
            SET stage = CASE WHEN ${ACCUMULATED_SQL} > 0 THEN 'DEPRECIATING' ELSE 'CAPITALIZED' END,
                updated_at = now()
          WHERE aa.asset_id = :assetId`,
        { replacements: { assetId: entry.assetId }, transaction },
      );
    }
    return getRunOrThrow(id, transaction);
  });
}

export async function getRunOrThrow(id: number, transaction?: Transaction): Promise<DepreciationRun> {
  const [row] = await postgres.query<DepreciationRun>(
    `SELECT ${RUN_COLUMNS} FROM asset_depreciation_runs WHERE id = :id`,
    { replacements: { id }, type: QueryTypes.SELECT, transaction },
  );
  if (!row) throw new NotFoundError(`El cierre ${id} no existe`);
  return row;
}

export async function getRunLines(id: number): Promise<DepreciationLine[]> {
  await getRunOrThrow(id);
  return postgres.query<DepreciationLine>(
    `SELECT e.asset_id AS "assetId", a.tag, e.amount::text AS amount, e.accumulated::text AS accumulated,
            e.book_value::text AS "bookValue"
       FROM asset_depreciation_entries e JOIN assets a ON a.id = e.asset_id
      WHERE e.run_id = :id ORDER BY a.tag`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
}

export async function listRuns(params: PaginationParams): Promise<{ items: DepreciationRun[]; total: number }> {
  const [countRow] = await postgres.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM asset_depreciation_runs`,
    { type: QueryTypes.SELECT },
  );
  const items = await postgres.query<DepreciationRun>(
    `SELECT ${RUN_COLUMNS} FROM asset_depreciation_runs ORDER BY period DESC, id DESC LIMIT :limit OFFSET :offset`,
    { replacements: { limit: params.limit, offset: getOffset(params) }, type: QueryTypes.SELECT },
  );
  return { items, total: countRow?.total ?? 0 };
}
