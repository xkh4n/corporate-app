import { ConflictError } from "./errors";

// 13 estados del flujo completo de una solicitud de compra (ver el plan de
// implementacion, seccion "1. Maquina de estados"). Unico modulo que define
// esta lista -antes vivia duplicada como VALID_STATUSES en
// purchaseRequest.service.ts y como un z.enum(...) literal en
// purchaseRequest.controller.ts-.
export const PURCHASE_REQUEST_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "IN_QUOTATION",
  "APPROVE_QUOTE",
  "QUOTE_APPROVED",
  "OC_GENERATED",
  "PENDING_DELIVERY",
  "AVAILABLE",
  "DELIVERED",
  "CANCELLED",
  "CLOSED",
] as const;

export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

// Terminales: ninguna transicion sale de aca (ni siquiera a CANCELLED).
const TERMINAL_STATUSES: readonly PurchaseRequestStatus[] = ["REJECTED", "CANCELLED", "CLOSED"];

// Todo estado no terminal puede cancelarse (ver la fila "CANCELLED |
// cualquiera" de la tabla de estados del plan) -se agrega una sola vez aca
// en vez de repetirlo en cada entrada de abajo.
const nonCancelTransitions: Record<PurchaseRequestStatus, readonly PurchaseRequestStatus[]> = {
  DRAFT: ["APPROVED", "REJECTED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  APPROVED: ["IN_QUOTATION"],
  REJECTED: [],
  IN_QUOTATION: ["APPROVE_QUOTE"],
  // APPROVE_QUOTE puede volver a IN_QUOTATION (reabrir para cargar mas
  // cotizaciones) o pasar directo a REJECTED (el aprobador rechaza todas).
  APPROVE_QUOTE: ["QUOTE_APPROVED", "IN_QUOTATION", "REJECTED"],
  QUOTE_APPROVED: ["OC_GENERATED"],
  OC_GENERATED: ["PENDING_DELIVERY"],
  // DELIVERED directo desde PENDING_DELIVERY: si la primera recepcion ya
  // cubre el total autorizado (ej. una sola linea, una sola OC), no hay
  // paso intermedio por AVAILABLE que recorrer -ver isRequestFullyReceived
  // en goodsReceipt.service.ts.
  PENDING_DELIVERY: ["AVAILABLE", "DELIVERED"],
  // CLOSED es alcanzable desde AVAILABLE y desde DELIVERED (ver la fila
  // "CLOSED | terminal | ... desde AVAILABLE/DELIVERED" de la tabla).
  AVAILABLE: ["DELIVERED", "CLOSED"],
  DELIVERED: ["CLOSED"],
  CANCELLED: [],
  CLOSED: [],
};

export const PURCHASE_REQUEST_TRANSITIONS: Record<PurchaseRequestStatus, readonly PurchaseRequestStatus[]> =
  Object.fromEntries(
    PURCHASE_REQUEST_STATUSES.map((status) => [
      status,
      TERMINAL_STATUSES.includes(status) ? nonCancelTransitions[status] : [...nonCancelTransitions[status], "CANCELLED"],
    ]),
  ) as Record<PurchaseRequestStatus, readonly PurchaseRequestStatus[]>;

// No-op si from === to (reguardado idempotente: varios endpoints pueden
// reintentar la misma transicion sin que eso sea un error de negocio real).
export function assertPurchaseRequestTransition(from: PurchaseRequestStatus, to: PurchaseRequestStatus): void {
  if (from === to) return;
  const allowed = PURCHASE_REQUEST_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new ConflictError(`No se puede pasar la solicitud de estado "${from}" a "${to}"`);
  }
}

export const PURCHASE_REQUEST_LINE_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type PurchaseRequestLineStatus = (typeof PURCHASE_REQUEST_LINE_STATUSES)[number];
