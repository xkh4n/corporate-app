// Calculo de depreciacion (plan 007). Puro y sin BD: lo usan el cierre
// mensual (assetDepreciation.service.ts), la tabla proyectada y los tests.
// Todo se calcula en CENTAVOS enteros para no arrastrar errores de punto
// flotante; la ultima cuota absorbe el redondeo y deja el valor libro
// exactamente en el valor residual.

export type DepreciationMethod = "LINEAR" | "ACCELERATED";

export interface DepreciationParams {
  cost: number; // costo capitalizado
  residual: number; // valor residual
  lifeMonths: number; // vida util normal (meses)
  method: DepreciationMethod;
}

export interface ScheduleRow {
  period: string; // "YYYY-MM"
  installment: number; // 1..n
  amount: number;
  accumulated: number;
  bookValue: number;
}

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function toCents(value: number): number {
  return Math.round(value * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

// Acelerada SII: la vida util se divide por 3 (redondeando hacia arriba, al
// menos un mes).
export function effectiveLifeMonths(lifeMonths: number, method: DepreciationMethod): number {
  return method === "ACCELERATED" ? Math.max(1, Math.ceil(lifeMonths / 3)) : lifeMonths;
}

// Periodo actual en hora de Chile: con UTC, las ultimas horas de un mes ya
// contarian como el mes siguiente.
export function currentPeriod(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit" })
    .formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

// Fecha de hoy (AAAA-MM-DD) en hora de Chile, mismo criterio que currentPeriod.
export function currentDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isValidPeriod(period: string): boolean {
  return PERIOD_PATTERN.test(period);
}

// "YYYY-MM" + n meses -> "YYYY-MM".
export function addMonths(period: string, months: number): string {
  const match = PERIOD_PATTERN.exec(period);
  if (!match) throw new Error(`Periodo invalido: ${period}`);
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

// Meses desde "from" hasta "to" (0 si es el mismo periodo, negativo si "to"
// es anterior).
export function monthsBetween(from: string, to: string): number {
  const a = PERIOD_PATTERN.exec(from);
  const b = PERIOD_PATTERN.exec(to);
  if (!a || !b) throw new Error(`Periodo invalido: ${from} / ${to}`);
  return Number(b[1]) * 12 + Number(b[2]) - (Number(a[1]) * 12 + Number(a[2]));
}

// Cuota del mes numero installmentIndex (0 = primer mes), dado lo ya
// depreciado. Devuelve 0 si ya no queda nada por depreciar. La ultima cuota
// (o la que dejaria el saldo por debajo del residual) es el remanente exacto.
export function monthlyInstallment(params: DepreciationParams, accumulated: number, installmentIndex: number): number {
  const depreciable = toCents(params.cost) - toCents(params.residual);
  const remaining = depreciable - toCents(accumulated);
  if (depreciable <= 0 || remaining <= 0) return 0;
  const life = effectiveLifeMonths(params.lifeMonths, params.method);
  const base = Math.round(depreciable / life);
  const isLast = installmentIndex >= life - 1;
  return fromCents(isLast || base >= remaining ? remaining : base);
}

// Tabla completa desde el periodo de inicio ("YYYY-MM").
export function buildSchedule(params: DepreciationParams, startPeriod: string): ScheduleRow[] {
  const life = effectiveLifeMonths(params.lifeMonths, params.method);
  const rows: ScheduleRow[] = [];
  let accumulated = 0;
  for (let index = 0; index < life; index++) {
    const amount = monthlyInstallment(params, accumulated, index);
    if (amount <= 0) break;
    accumulated = fromCents(toCents(accumulated) + toCents(amount));
    rows.push({
      period: addMonths(startPeriod, index),
      installment: index + 1,
      amount,
      accumulated,
      bookValue: fromCents(toCents(params.cost) - toCents(accumulated)),
    });
  }
  return rows;
}
