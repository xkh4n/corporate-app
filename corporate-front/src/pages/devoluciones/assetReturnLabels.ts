import type { AssetReturnScope, AssetReturnStatus } from "../../types/assetReturn";

export const RETURN_SCOPE_LABELS: Record<AssetReturnScope, string> = {
  OWN: "Mis equipos",
  OTHERS: "Equipos de otro usuario",
};

export const RETURN_STATUS_LABELS: Record<AssetReturnStatus, string> = {
  DRAFT: "Borrador",
  SENT: "Enviada",
  RECEIVED: "Recibida",
  CANCELLED: "Cancelada",
};

export const RETURN_STATUS_CLASSES: Record<AssetReturnStatus, string> = {
  DRAFT: "bg-amber-100 text-amber-800",
  SENT: "bg-sky-100 text-sky-800",
  RECEIVED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-600",
};

export const RETURN_STATUS_OPTIONS: { value: AssetReturnStatus; label: string }[] = (
  Object.keys(RETURN_STATUS_LABELS) as AssetReturnStatus[]
).map((value) => ({ value, label: RETURN_STATUS_LABELS[value] }));

// Igual que el limite del servidor para la guia de despacho (assetReturn.routes.ts).
export const MAX_GUIDE_SIZE_BYTES = 5 * 1024 * 1024;
