import { describe, expect, it } from "vitest";
import { computeLineChanges, needsSupportFollowUp } from "./inventoryCountChanges";
import type { InventoryLineComparable } from "../types/postgres/inventoryCount.types";

const linked = (overrides: Partial<InventoryLineComparable> = {}): InventoryLineComparable => ({
  assetCreated: false,
  resultingStatusCode: "ASSIGNED",
  holderUserId: 7,
  costCenterId: 10,
  systemStatusCode: "ASSIGNED",
  systemHolderUserId: 7,
  systemCostCenterId: 10,
  ...overrides,
});

describe("computeLineChanges", () => {
  it("sin cambios cuando el activo queda como estaba", () => {
    expect(computeLineChanges(linked())).toEqual([]);
  });

  it("una linea con activo creado por la toma nunca tiene cambios", () => {
    const line = linked({ assetCreated: true, systemStatusCode: null, systemHolderUserId: null, systemCostCenterId: null });
    expect(computeLineChanges(line)).toEqual([]);
  });

  it("detecta cambio de estado y de tenedor (disponible -> asignado)", () => {
    const line = linked({ systemStatusCode: "AVAILABLE", systemHolderUserId: null });
    expect(computeLineChanges(line)).toEqual(["STATUS_CHANGED", "HOLDER_CHANGED"]);
  });

  it("reasignacion a otro usuario: solo cambia el tenedor", () => {
    expect(computeLineChanges(linked({ holderUserId: 9 }))).toEqual(["HOLDER_CHANGED"]);
  });

  it("un usuario informado en un equipo que queda en soporte no es cambio de tenedor", () => {
    const line = linked({ resultingStatusCode: "SUPPORT", systemStatusCode: "SUPPORT", systemHolderUserId: null });
    expect(computeLineChanges(line)).toEqual([]);
  });

  it("devolucion -> soporte: cambia el estado y no el tenedor", () => {
    const line = linked({ resultingStatusCode: "SUPPORT", systemStatusCode: "RETURNED", systemHolderUserId: null });
    expect(computeLineChanges(line)).toEqual(["STATUS_CHANGED"]);
  });

  it("baja -> devaluado: cambian estado y tenedor", () => {
    const line = linked({ resultingStatusCode: "DEVALUATED", systemStatusCode: "DECOMMISSIONED", systemHolderUserId: null });
    expect(computeLineChanges(line)).toEqual(["STATUS_CHANGED", "HOLDER_CHANGED"]);
  });

  it("cambio de centro de costo (ubicacion), incluso desde un activo sin centro", () => {
    expect(computeLineChanges(linked({ costCenterId: 11 }))).toEqual(["COST_CENTER_CHANGED"]);
    expect(computeLineChanges(linked({ systemCostCenterId: null }))).toEqual(["COST_CENTER_CHANGED"]);
  });
});

describe("needsSupportFollowUp", () => {
  it("solo cuando el sistema lo tenia en devolucion", () => {
    expect(needsSupportFollowUp({ systemStatusCode: "RETURNED" })).toBe(true);
    expect(needsSupportFollowUp({ systemStatusCode: "ASSIGNED" })).toBe(false);
    expect(needsSupportFollowUp({ systemStatusCode: null })).toBe(false);
  });
});
