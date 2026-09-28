import { logger } from "./logger";

// Aviso de "cambio el estado de una solicitud de compra" (plan 010). Lo emite
// purchaseRequest.service.ts despues de guardar el estado y lo escucha el
// Service Desk para mover el ticket vinculado, sin que el modulo de compras
// dependa del de tickets. Los listeners corren en segundo plano: un fallo se
// loguea y no afecta a quien cambio el estado (el barrido del SLA reconcilia).
type Listener = (requestId: number) => Promise<void>;

const listeners: Listener[] = [];

export function onPurchaseRequestStatusChanged(listener: Listener): void {
  if (!listeners.includes(listener)) listeners.push(listener);
}

export function emitPurchaseRequestStatusChanged(requestId: number): void {
  for (const listener of listeners) {
    void listener(requestId).catch((err: unknown) => {
      logger.error({ err, requestId }, "No se pudo propagar el cambio de estado de la solicitud de compra");
    });
  }
}
