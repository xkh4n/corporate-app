import { describe, expect, it } from "vitest";
import {
  allowedDeclaredStatuses,
  forcedDeclaredStatus,
  instructionFor,
  IN_TRANSIT_INSTRUCTION,
  planExistingAssetChange,
  RETURNED_INSTRUCTION,
  type PlanStep,
} from "./inventoryAssetTransition";
import type { InventoryLineStatusCode } from "../models/postgres/inventoryCountLine.model";

function plan(systemStatus: string, declared: InventoryLineStatusCode, holderIsSame = false) {
  return planExistingAssetChange({ systemStatus, declared, holderIsSame });
}
const move = (movementType: Extract<PlanStep, { kind: "MOVEMENT" }>["movementType"], withHolder = false): PlanStep => ({
  kind: "MOVEMENT",
  movementType,
  withHolder,
});

describe("planExistingAssetChange", () => {
  it("devolucion: queda en SOPORTE sin importar lo declarado", () => {
    for (const declared of ["ASSIGNED", "SUPPORT", "AVAILABLE", "DAMAGED", "DECOMMISSIONED"] as const) {
      expect(plan("RETURNED", declared)).toEqual({ ok: true, resultingStatusCode: "SUPPORT", steps: [move("SUPPORT")] });
    }
  });

  it("en transito de devolucion: cualquier estado declarado se rechaza y no hay estados permitidos", () => {
    for (const declared of ["ASSIGNED", "SUPPORT", "AVAILABLE", "DAMAGED", "DECOMMISSIONED"] as const) {
      expect(plan("MOVE_TO_RETURNED", declared)).toEqual({ ok: false, reason: IN_TRANSIT_INSTRUCTION });
    }
    expect(allowedDeclaredStatuses("MOVE_TO_RETURNED")).toEqual([]);
    expect(forcedDeclaredStatus("MOVE_TO_RETURNED")).toBeNull();
    expect(instructionFor("MOVE_TO_RETURNED")).toBe(IN_TRANSIT_INSTRUCTION);
  });

  it("baja encontrada en uso: DEVALUATED asignado al usuario", () => {
    expect(plan("DECOMMISSIONED", "ASSIGNED")).toEqual({
      ok: true,
      resultingStatusCode: "DEVALUATED",
      steps: [move("DEVALUATED", true)],
    });
  });

  it("baja: seguir de baja es sin cambio; cualquier otro estado se rechaza", () => {
    expect(plan("DECOMMISSIONED", "DECOMMISSIONED")).toEqual({ ok: true, resultingStatusCode: "DECOMMISSIONED", steps: [] });
    for (const declared of ["SUPPORT", "AVAILABLE", "DAMAGED"] as const) {
      expect(plan("DECOMMISSIONED", declared).ok).toBe(false);
    }
  });

  it("con baja contable (WRITTEN_OFF, plan 013): igual que una baja", () => {
    expect(plan("WRITTEN_OFF", "ASSIGNED")).toEqual({
      ok: true,
      resultingStatusCode: "DEVALUATED",
      steps: [move("DEVALUATED", true)],
    });
    expect(plan("WRITTEN_OFF", "DECOMMISSIONED")).toEqual({ ok: true, resultingStatusCode: "WRITTEN_OFF", steps: [] });
    expect(plan("WRITTEN_OFF", "AVAILABLE").ok).toBe(false);
  });

  it("devaluado: mismo usuario sin cambio, otro usuario movimiento nuevo, disponible rechazado", () => {
    expect(plan("DEVALUATED", "ASSIGNED", true)).toEqual({ ok: true, resultingStatusCode: "DEVALUATED", steps: [] });
    expect(plan("DEVALUATED", "ASSIGNED", false)).toEqual({
      ok: true,
      resultingStatusCode: "DEVALUATED",
      steps: [move("DEVALUATED", true)],
    });
    expect(plan("DEVALUATED", "AVAILABLE").ok).toBe(false);
    expect(plan("DEVALUATED", "SUPPORT")).toMatchObject({ ok: true, resultingStatusCode: "SUPPORT" });
    expect(plan("DEVALUATED", "DAMAGED")).toMatchObject({ ok: true, resultingStatusCode: "DAMAGED" });
    expect(plan("DEVALUATED", "DECOMMISSIONED")).toMatchObject({ ok: true, resultingStatusCode: "DECOMMISSIONED" });
  });

  it("asignar un disponible: movimiento ASSIGNED directo", () => {
    expect(plan("AVAILABLE", "ASSIGNED")).toEqual({
      ok: true,
      resultingStatusCode: "ASSIGNED",
      steps: [move("ASSIGNED", true)],
    });
  });

  it("asignar un RECEIVED, SUPPORT o DAMAGED: pasa antes a AVAILABLE (guard de ASSIGNED)", () => {
    for (const system of ["RECEIVED", "SUPPORT", "DAMAGED"]) {
      expect(plan(system, "ASSIGNED")).toEqual({
        ok: true,
        resultingStatusCode: "ASSIGNED",
        steps: [{ kind: "SET_STATUS", statusCode: "AVAILABLE" }, move("ASSIGNED", true)],
      });
    }
  });

  it("asignado: mismo usuario sin cambio, otro usuario REASSIGNED", () => {
    expect(plan("ASSIGNED", "ASSIGNED", true)).toEqual({ ok: true, resultingStatusCode: "ASSIGNED", steps: [] });
    expect(plan("ASSIGNED", "ASSIGNED", false)).toEqual({
      ok: true,
      resultingStatusCode: "ASSIGNED",
      steps: [move("REASSIGNED", true)],
    });
  });

  it("asignado no puede quedar disponible desde la toma", () => {
    expect(plan("ASSIGNED", "AVAILABLE").ok).toBe(false);
  });

  it("soporte, danado y baja como estado declarado", () => {
    expect(plan("AVAILABLE", "SUPPORT")).toEqual({ ok: true, resultingStatusCode: "SUPPORT", steps: [move("SUPPORT")] });
    expect(plan("SUPPORT", "SUPPORT")).toEqual({ ok: true, resultingStatusCode: "SUPPORT", steps: [] });
    expect(plan("ASSIGNED", "DAMAGED")).toEqual({
      ok: true,
      resultingStatusCode: "DAMAGED",
      steps: [{ kind: "SET_STATUS", statusCode: "DAMAGED" }],
    });
    expect(plan("DAMAGED", "DAMAGED")).toEqual({ ok: true, resultingStatusCode: "DAMAGED", steps: [] });
    expect(plan("ASSIGNED", "DECOMMISSIONED")).toEqual({
      ok: true,
      resultingStatusCode: "DECOMMISSIONED",
      steps: [move("DECOMMISSIONED")],
    });
  });

  it("disponible desde estados no asignados: SET_STATUS, o sin cambio si ya lo esta", () => {
    expect(plan("SUPPORT", "AVAILABLE")).toEqual({
      ok: true,
      resultingStatusCode: "AVAILABLE",
      steps: [{ kind: "SET_STATUS", statusCode: "AVAILABLE" }],
    });
    expect(plan("AVAILABLE", "AVAILABLE")).toEqual({ ok: true, resultingStatusCode: "AVAILABLE", steps: [] });
  });

  it("un estado desconocido se rechaza", () => {
    expect(plan("INVENTADO", "ASSIGNED").ok).toBe(false);
  });
});

describe("allowedDeclaredStatuses / forcedDeclaredStatus / instructionFor", () => {
  it("un activo asignado no ofrece DISPONIBLE; una baja solo ofrece ASIGNADO y BAJA", () => {
    expect(allowedDeclaredStatuses("ASSIGNED")).toEqual(["ASSIGNED", "SUPPORT", "DAMAGED", "DECOMMISSIONED"]);
    expect(allowedDeclaredStatuses("DECOMMISSIONED")).toEqual(["ASSIGNED", "DECOMMISSIONED"]);
    expect(allowedDeclaredStatuses("AVAILABLE")).toEqual(["ASSIGNED", "SUPPORT", "AVAILABLE", "DAMAGED", "DECOMMISSIONED"]);
  });

  it("la devolucion fuerza SOPORTE y trae la instruccion", () => {
    expect(forcedDeclaredStatus("RETURNED")).toBe("SUPPORT");
    expect(forcedDeclaredStatus("ASSIGNED")).toBeNull();
    expect(instructionFor("RETURNED")).toBe(RETURNED_INSTRUCTION);
    expect(instructionFor("DECOMMISSIONED")).toContain("Devaluado");
    expect(instructionFor("AVAILABLE")).toBeNull();
  });
});
