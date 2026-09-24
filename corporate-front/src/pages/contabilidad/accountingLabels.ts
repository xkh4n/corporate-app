import type { AccountingStage, Classification, DepreciationMethod } from "../../types/assetAccounting";

// Etiquetas y formato compartidos por las pantallas de Contabilidad >
// Gestion de Activos (plan 007).

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  FIXED_ASSET: "Activo fijo",
  EXPENSE: "Gasto",
  INVENTORY: "Inventario",
};

export const STAGE_LABEL: Record<AccountingStage, string> = {
  CLASSIFIED: "Clasificado",
  COSTED: "Costo fijado",
  CAPITALIZED: "Capitalizado",
  DEPRECIATING: "En depreciación",
  FULLY_DEPRECIATED: "Totalmente depreciado",
  WRITTEN_OFF: "Dado de baja",
};

export const METHOD_LABEL: Record<DepreciationMethod, string> = {
  LINEAR: "Lineal",
  ACCELERATED: "Acelerada (SII)",
};

export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(Number(value));
}

// "2026-10" -> "octubre 2026"
export function formatPeriod(period: string | null | undefined): string {
  if (!period) return "-";
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  return new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

// Periodo "AAAA-MM" a partir de un input type="month" (mismo formato).
export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// Monto tipeado por el usuario -> numero, o null si no es valido. Con coma es
// formato chileno ("1.234,5": puntos de miles, coma decimal); sin coma se lee
// tal cual ("1234.5").
export function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
