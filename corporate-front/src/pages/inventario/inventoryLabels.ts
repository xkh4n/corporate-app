import type { InventoryChange, InventoryLineStatusCode, InventoryReportLine } from "../../types/inventoryCount";

// Estados que el auditor puede declarar, en el orden del combo. "Mantención"
// es SUPPORT y "Baja" es DECOMMISSIONED en el modelo de activos.
export const LINE_STATUS_OPTIONS: { value: InventoryLineStatusCode; label: string }[] = [
  { value: "ASSIGNED", label: "Asignado" },
  { value: "SUPPORT", label: "Mantención" },
  { value: "AVAILABLE", label: "Disponible" },
  { value: "DAMAGED", label: "Dañado" },
  { value: "DECOMMISSIONED", label: "Baja" },
];

// Incluye los estados que el auditor no puede declarar pero que el sistema
// puede tener: RECEIVED, RETURNED (devolución), MOVE_TO_RETURNED (en tránsito
// hacia Adquisiciones) y DEVALUATED (baja reactivada).
const STATUS_LABELS: Record<string, string> = {
  ...Object.fromEntries(LINE_STATUS_OPTIONS.map((option) => [option.value, option.label])),
  RECEIVED: "Ingresado",
  RETURNED: "Devolución",
  DEVALUATED: "Devaluado",
  MOVE_TO_RETURNED: "En tránsito a devolución",
  RETURNED_TO_SUPPLIER: "Devuelto a proveedor",
};

export function statusLabel(code: string | null): string {
  if (!code) return "-";
  return STATUS_LABELS[code] ?? code;
}

export function isLineStatusCode(code: string | null): code is InventoryLineStatusCode {
  return LINE_STATUS_OPTIONS.some((option) => option.value === code);
}

export const CHANGE_LABELS: Record<InventoryChange, string> = {
  STATUS_CHANGED: "Estado",
  HOLDER_CHANGED: "Usuario",
  COST_CENTER_CHANGED: "Centro de costo",
};

const costCenterText = (center: { code: number; name: string } | null): string =>
  center ? `${center.code} · ${center.name}` : "sin centro";

// "antes → después" de lo que la toma cambió en el activo.
export function changeDetail(line: InventoryReportLine, change: InventoryChange): string {
  switch (change) {
    case "STATUS_CHANGED":
      return `${statusLabel(line.systemStatusCode)} → ${statusLabel(line.statusCode)}`;
    case "HOLDER_CHANGED":
      return `${line.systemHolder?.fullName ?? "sin usuario"} → ${line.holder?.fullName ?? "sin usuario"}`;
    case "COST_CENTER_CHANGED":
      return `${costCenterText(line.systemCostCenter)} → ${costCenterText(line.costCenter)}`;
  }
}

export const SUPPORT_FOLLOW_UP_TEXT = "Enviar a Soporte TI / Adquisiciones TI";

export function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
}
