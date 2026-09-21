import type { InventoryChange, InventoryLineComparable } from "../types/postgres/inventoryCount.types";

// Estados en los que el activo esta en manos de un usuario: solo entonces el
// tenedor es un dato que puede haber cambiado.
const HOLDER_STATUSES = new Set(["ASSIGNED", "DEVALUATED"]);

// Que CAMBIO la toma en un activo que ya existia (snapshot del sistema al
// capturar vs. como quedo). Pura (sin BD). Una linea con activo creado por la
// toma no tiene cambios: es el origen del dato.
export function computeLineChanges(line: InventoryLineComparable): InventoryChange[] {
  if (line.assetCreated) return [];

  const changes: InventoryChange[] = [];

  if (line.systemStatusCode !== null && line.resultingStatusCode !== null && line.resultingStatusCode !== line.systemStatusCode) {
    changes.push("STATUS_CHANGED");
  }

  const holderRelevant =
    HOLDER_STATUSES.has(line.resultingStatusCode ?? "") || HOLDER_STATUSES.has(line.systemStatusCode ?? "");
  if (holderRelevant && (line.holderUserId ?? null) !== (line.systemHolderUserId ?? null)) {
    changes.push("HOLDER_CHANGED");
  }

  // Ubicacion = centro de costo. Un activo sin centro de costo previo que recibe
  // uno tambien cuenta como cambio.
  if (line.costCenterId !== null && line.costCenterId !== line.systemCostCenterId) {
    changes.push("COST_CENTER_CHANGED");
  }

  return changes;
}

// La toma dejo al activo en Soporte porque el sistema lo tenia en devolucion:
// el auditor debe instruir su envio a Soporte TI / Adquisiciones TI.
export function needsSupportFollowUp(line: Pick<InventoryLineComparable, "systemStatusCode">): boolean {
  return line.systemStatusCode === "RETURNED";
}
