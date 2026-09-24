// Tiempo habil del Service Desk (plan 009): los SLA se miden en minutos
// habiles de un calendario (horario por dia de semana + feriados) en su zona
// horaria. Puro, sin BD: el calendario llega ya cargado.
//
// Sin librerias de fechas: Intl (ICU completo, incluido en Node) da la hora
// local de cualquier instante en la zona, y de ahi se deriva el desfase. Asi
// los cambios de horario de Chile (abril/septiembre) salen del tzdata del
// runtime, no de una tabla propia.

export interface BusinessInterval {
  // 1 = lunes ... 7 = domingo (ISO).
  weekday: number;
  // "HH:MM", hora local. end > start (un tramo no cruza la medianoche).
  start: string;
  end: string;
}

export interface BusinessCalendar {
  timezone: string;
  hours: BusinessInterval[];
  // "YYYY-MM-DD", fecha local.
  holidays: string[];
}

const MINUTE_MS = 60_000;
// Tope de dias que se recorren buscando horario habil: un calendario sin
// ningun tramo (o con 10 anios de feriados) no puede colgar la request.
const MAX_DAYS_SCANNED = 3660;

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

// Lanza RangeError si la zona no existe: se valida al guardar el calendario.
export function assertValidTimezone(timezone: string): void {
  formatterFor(timezone);
}

function localParts(instant: number, timezone: string): LocalDate & { hour: number; minute: number; second: number } {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

// Desfase (ms) de la zona en ese instante: hora local leida como UTC - instante.
function offsetAt(instant: number, timezone: string): number {
  const p = localParts(instant, timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

// Instante UTC de una hora local. Dos pasadas: el desfase se recalcula en el
// resultado por si la primera suposicion cayo al otro lado de un cambio de
// horario. Una hora local inexistente (salto de primavera) queda corrida
// hacia adelante, que es lo esperable para un reloj de SLA.
function localToInstant(date: LocalDate, minuteOfDay: number, timezone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minuteOfDay);
  const first = wall - offsetAt(wall, timezone);
  const second = wall - offsetAt(first, timezone);
  return second;
}

function nextDay(date: LocalDate): LocalDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function isoWeekday(date: LocalDate): number {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function dateKey(date: LocalDate): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function parseHHMM(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new RangeError(`Hora invalida: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

interface PreparedCalendar {
  timezone: string;
  byWeekday: Map<number, { start: number; end: number }[]>;
  holidays: Set<string>;
}

function prepare(calendar: BusinessCalendar): PreparedCalendar {
  const byWeekday = new Map<number, { start: number; end: number }[]>();
  for (const interval of calendar.hours) {
    const start = parseHHMM(interval.start);
    const end = interval.end === "24:00" ? 24 * 60 : parseHHMM(interval.end);
    if (end <= start) continue;
    const list = byWeekday.get(interval.weekday) ?? [];
    list.push({ start, end });
    byWeekday.set(interval.weekday, list);
  }
  for (const list of byWeekday.values()) list.sort((a, b) => a.start - b.start);
  return { timezone: calendar.timezone, byWeekday, holidays: new Set(calendar.holidays) };
}

// Tramos habiles del dia local, como instantes UTC [inicio, fin).
function dayWindows(calendar: PreparedCalendar, date: LocalDate): [number, number][] {
  if (calendar.holidays.has(dateKey(date))) return [];
  const intervals = calendar.byWeekday.get(isoWeekday(date)) ?? [];
  return intervals.map(({ start, end }) => [
    localToInstant(date, start, calendar.timezone),
    localToInstant(date, end, calendar.timezone),
  ]);
}

function localDateOf(instant: number, timezone: string): LocalDate {
  const { year, month, day } = localParts(instant, timezone);
  return { year, month, day };
}

// Suma minutos habiles a un instante. 0 minutos devuelve el propio instante si
// cae en horario habil, o el inicio del proximo tramo habil si no.
export function addBusinessMinutes(start: Date, minutes: number, calendar: BusinessCalendar): Date {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError("Los minutos habiles deben ser >= 0");
  const prepared = prepare(calendar);
  let remainingMs = Math.round(minutes) * MINUTE_MS;
  let cursor = start.getTime();
  let date = localDateOf(cursor, prepared.timezone);

  for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned++, date = nextDay(date)) {
    for (const [windowStart, windowEnd] of dayWindows(prepared, date)) {
      if (cursor >= windowEnd) continue;
      const from = Math.max(cursor, windowStart);
      const available = windowEnd - from;
      if (remainingMs <= available) return new Date(from + remainingMs);
      remainingMs -= available;
      cursor = windowEnd;
    }
  }
  throw new RangeError("El calendario no tiene horario habil suficiente para calcular el vencimiento");
}

// Minutos habiles entre dos instantes (0 si to <= from).
export function businessMinutesBetween(from: Date, to: Date, calendar: BusinessCalendar): number {
  const start = from.getTime();
  const end = to.getTime();
  if (end <= start) return 0;
  const prepared = prepare(calendar);
  let totalMs = 0;
  let date = localDateOf(start, prepared.timezone);
  const lastDate = dateKey(localDateOf(end, prepared.timezone));

  for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned++, date = nextDay(date)) {
    for (const [windowStart, windowEnd] of dayWindows(prepared, date)) {
      const overlap = Math.min(end, windowEnd) - Math.max(start, windowStart);
      if (overlap > 0) totalMs += overlap;
    }
    if (dateKey(date) === lastDate) break;
  }
  return Math.floor(totalMs / MINUTE_MS);
}
