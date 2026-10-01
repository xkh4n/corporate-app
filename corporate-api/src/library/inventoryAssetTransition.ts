import type { InventoryLineStatusCode } from "../models/postgres/inventoryCountLine.model";

// Que hace la toma de inventario con un activo que YA existe en el sistema. Pura
// (sin BD): es la unica fuente de verdad, la usa el servidor para aplicar el
// cambio y para calcular los estados permitidos que devuelve el lookup. Ver la
// tabla de reglas en .claude/planes/003-toma-inventario-ajustes-y-valorizacion.html.

export type PlanStep =
  // Cambio directo de estado, sin movimiento (no hay tipo de movimiento que lo represente).
  | { kind: "SET_STATUS"; statusCode: "AVAILABLE" | "DAMAGED" }
  // Movimiento real (deja historial). withHolder: lleva el usuario ingresado.
  | {
      kind: "MOVEMENT";
      movementType: "ASSIGNED" | "REASSIGNED" | "SUPPORT" | "DECOMMISSIONED" | "DEVALUATED";
      withHolder: boolean;
    };

export interface ExistingAssetPlan {
  ok: true;
  // Estado con el que queda el activo tras aplicar los pasos.
  resultingStatusCode: string;
  steps: PlanStep[];
}

export interface RejectedPlan {
  ok: false;
  reason: string;
}

export interface PlanInput {
  systemStatus: string;
  declared: InventoryLineStatusCode;
  // El usuario ingresado ya es el tenedor vigente del activo.
  holderIsSame: boolean;
  // Plan 018: tag ACT. Un arriendo/servicio (ARR/SRV) no se da de baja desde la toma: se declara
  // Dañado y se devuelve a su proveedor en Dar de Baja Activos. Por defecto true.
  accountingAsset?: boolean;
}

export const RETURNED_INSTRUCTION =
  "El activo estaba en devolución: queda en Mantención. Envíelo a Soporte TI o Adquisiciones TI.";
export const IN_TRANSIT_INSTRUCTION =
  "El activo está en tránsito de devolución hacia Adquisiciones TI: no se puede inventariar hasta que se reciba.";
export const DECOMMISSIONED_INSTRUCTION =
  "El activo está dado de baja en el sistema. Si lo asigna quedará Devaluado (valor 0), sin afectar el Kardex.";

export const SUPPLIER_RETURNED_INSTRUCTION =
  "El activo figura devuelto a su proveedor: no debería estar en el sitio. Avise a Adquisiciones TI.";
export const NON_ACCOUNTING_DECOMMISSION_REASON =
  "Un arriendo o servicio no se da de baja desde la toma: declárelo Dañado y devuélvalo a su proveedor en Dar de Baja Activos";

const DECLARABLE_STATUSES: InventoryLineStatusCode[] = ["ASSIGNED", "SUPPORT", "AVAILABLE", "DAMAGED", "DECOMMISSIONED"];

const noChange = (statusCode: string): ExistingAssetPlan => ({ ok: true, resultingStatusCode: statusCode, steps: [] });
const reject = (reason: string): RejectedPlan => ({ ok: false, reason });

export function planExistingAssetChange(input: PlanInput): ExistingAssetPlan | RejectedPlan {
  const { systemStatus: system, declared, holderIsSame } = input;
  const accountingAsset = input.accountingAsset ?? true;

  // Despachado con guia hacia Adquisiciones (plan 004): ya no esta en el sitio, la
  // toma no lo toca hasta que Adquisiciones lo reciba.
  if (system === "MOVE_TO_RETURNED") return reject(IN_TRANSIT_INSTRUCTION);
  // Plan 018: ya no es de la empresa.
  if (system === "RETURNED_TO_SUPPLIER") return reject(SUPPLIER_RETURNED_INSTRUCTION);

  // En devolucion: sin importar lo declarado, queda en soporte para que el
  // auditor lo derive a Soporte TI / Adquisiciones TI.
  if (system === "RETURNED") {
    return {
      ok: true,
      resultingStatusCode: "SUPPORT",
      steps: [{ kind: "MOVEMENT", movementType: "SUPPORT", withHolder: false }],
    };
  }

  // Plan 018: una baja nueva iria a Baja Contable, que solo admite ACT. Una baja de antes (DECOMMISSIONED o
  // WRITTEN_OFF) puede seguir declarandose «Baja» (sin cambio).
  if (!accountingAsset && declared === "DECOMMISSIONED" && system !== "DECOMMISSIONED" && system !== "WRITTEN_OFF") {
    return reject(NON_ACCOUNTING_DECOMMISSION_REASON);
  }

  // Una baja encontrada en uso queda devaluada (asignada, valor 0, sin Kardex). Igual si ya tiene
  // baja contable (WRITTEN_OFF, plan 013): declararla «Baja» no la cambia.
  if (system === "DECOMMISSIONED" || system === "WRITTEN_OFF") {
    if (declared === "ASSIGNED") {
      return {
        ok: true,
        resultingStatusCode: "DEVALUATED",
        steps: [{ kind: "MOVEMENT", movementType: "DEVALUATED", withHolder: true }],
      };
    }
    if (declared === "DECOMMISSIONED") return noChange(system);
    return reject("Un activo dado de baja solo puede quedar Asignado (Devaluado) o seguir De baja");
  }

  if (system === "DEVALUATED") {
    switch (declared) {
      case "ASSIGNED":
        return holderIsSame
          ? noChange(system)
          : {
              ok: true,
              resultingStatusCode: "DEVALUATED",
              steps: [{ kind: "MOVEMENT", movementType: "DEVALUATED", withHolder: true }],
            };
      case "SUPPORT":
        return {
          ok: true,
          resultingStatusCode: "SUPPORT",
          steps: [{ kind: "MOVEMENT", movementType: "SUPPORT", withHolder: false }],
        };
      case "DAMAGED":
        return { ok: true, resultingStatusCode: "DAMAGED", steps: [{ kind: "SET_STATUS", statusCode: "DAMAGED" }] };
      case "DECOMMISSIONED":
        return {
          ok: true,
          resultingStatusCode: "DECOMMISSIONED",
          steps: [{ kind: "MOVEMENT", movementType: "DECOMMISSIONED", withHolder: false }],
        };
      case "AVAILABLE":
        return reject("Un activo devaluado en uso no puede quedar Disponible desde la toma: registre su devolución");
    }
  }

  if (!["RECEIVED", "AVAILABLE", "ASSIGNED", "SUPPORT", "DAMAGED"].includes(system)) {
    return reject(`Estado de activo desconocido para la toma: ${system}`);
  }

  switch (declared) {
    case "ASSIGNED":
      if (system === "ASSIGNED") {
        return holderIsSame
          ? noChange(system)
          : {
              ok: true,
              resultingStatusCode: "ASSIGNED",
              steps: [{ kind: "MOVEMENT", movementType: "REASSIGNED", withHolder: true }],
            };
      }
      // ASSIGNED exige AVAILABLE (guard de createAssetMovement): RECEIVED, SUPPORT
      // y DAMAGED pasan primero a AVAILABLE dentro de la misma transaccion.
      return {
        ok: true,
        resultingStatusCode: "ASSIGNED",
        steps: [
          ...(system === "AVAILABLE" ? [] : [{ kind: "SET_STATUS", statusCode: "AVAILABLE" } as const]),
          { kind: "MOVEMENT", movementType: "ASSIGNED", withHolder: true },
        ],
      };
    case "SUPPORT":
      return system === "SUPPORT"
        ? noChange(system)
        : {
            ok: true,
            resultingStatusCode: "SUPPORT",
            steps: [{ kind: "MOVEMENT", movementType: "SUPPORT", withHolder: false }],
          };
    case "DAMAGED":
      return system === "DAMAGED"
        ? noChange(system)
        : { ok: true, resultingStatusCode: "DAMAGED", steps: [{ kind: "SET_STATUS", statusCode: "DAMAGED" }] };
    case "DECOMMISSIONED":
      return {
        ok: true,
        resultingStatusCode: "DECOMMISSIONED",
        steps: [{ kind: "MOVEMENT", movementType: "DECOMMISSIONED", withHolder: false }],
      };
    case "AVAILABLE":
      if (system === "ASSIGNED") {
        return reject("Un activo asignado no puede quedar Disponible desde la toma: registre su devolución");
      }
      return system === "AVAILABLE"
        ? noChange(system)
        : { ok: true, resultingStatusCode: "AVAILABLE", steps: [{ kind: "SET_STATUS", statusCode: "AVAILABLE" }] };
  }
}

// Estados que el auditor puede elegir para un activo que el sistema tiene en
// systemStatus (los que planExistingAssetChange no rechaza). El holder no
// cambia lo que es posible, solo si hay o no cambio.
export function allowedDeclaredStatuses(systemStatus: string, accountingAsset = true): InventoryLineStatusCode[] {
  return DECLARABLE_STATUSES.filter(
    (declared) => planExistingAssetChange({ systemStatus, declared, holderIsSame: false, accountingAsset }).ok,
  );
}

// Estado que la toma impone sin importar lo declarado (hoy solo la devolucion).
export function forcedDeclaredStatus(systemStatus: string): InventoryLineStatusCode | null {
  return systemStatus === "RETURNED" ? "SUPPORT" : null;
}

// Aviso para el auditor segun el estado que el sistema tiene del activo.
export function instructionFor(systemStatus: string): string | null {
  if (systemStatus === "RETURNED") return RETURNED_INSTRUCTION;
  if (systemStatus === "MOVE_TO_RETURNED") return IN_TRANSIT_INSTRUCTION;
  if (systemStatus === "RETURNED_TO_SUPPLIER") return SUPPLIER_RETURNED_INSTRUCTION;
  if (systemStatus === "DECOMMISSIONED" || systemStatus === "WRITTEN_OFF") return DECOMMISSIONED_INSTRUCTION;
  return null;
}
