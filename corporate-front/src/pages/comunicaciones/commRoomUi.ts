import type { RoomAccessGrant } from "../../types/commRoom";

// Utilidades de las pantallas de Acceso Sala (plan 016).

// <input type="datetime-local"> trabaja en hora local sin zona: "YYYY-MM-DDTHH:mm".
export function toDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// De vuelta a ISO con zona para la API (la hora local del navegador, Santiago).
export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatPeriod(from: string | null, until: string | null): string {
  const format = (iso: string) => new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
  if (!from) return "-";
  return until ? `${format(from)} → ${format(until)}` : `${format(from)} → sin término`;
}

// Estado que se muestra: un acceso ACTIVE con inicio futuro todavia no habilita el ingreso.
export function grantStatusLabel(grant: Pick<RoomAccessGrant, "status" | "isValidNow">): string {
  if (grant.status === "ACTIVE") return grant.isValidNow ? "Vigente" : "Programado";
  return grant.status === "EXPIRED" ? "Vencido" : "Revocado";
}

export function grantStatusClass(grant: Pick<RoomAccessGrant, "status" | "isValidNow">): string {
  if (grant.status === "ACTIVE") return grant.isValidNow ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800";
  return grant.status === "EXPIRED" ? "bg-slate-200 text-slate-700" : "bg-rose-100 text-rose-800";
}

export const PAGE_CLASS = "flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6";
export const TITLE_CLASS = "text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600";
export const TABLE_WRAP = "overflow-x-auto rounded-lg border border-slate-200 bg-white";
export const TH = "px-3 py-2 text-left font-semibold text-slate-600";
export const TD = "px-3 py-2 text-slate-700";
