import { describe, expect, it } from "vitest";
import {
  buildVariablesSchema,
  canAgentTransition,
  canRequesterCancel,
  catalogFieldsSchema,
  DEFAULT_PRIORITY_MATRIX,
  matrixKey,
  resolvePriority,
  type PriorityMatrix,
} from "./ticketRules";

const MATRIX: PriorityMatrix = new Map(DEFAULT_PRIORITY_MATRIX.map((row) => [matrixKey(row.impact, row.urgency), row.priority]));

describe("transiciones del agente", () => {
  it("permite el ciclo normal", () => {
    expect(canAgentTransition("ASSIGNED", "IN_PROGRESS")).toBe(true);
    expect(canAgentTransition("IN_PROGRESS", "ON_HOLD")).toBe(true);
    expect(canAgentTransition("ON_HOLD", "IN_PROGRESS")).toBe(true);
    expect(canAgentTransition("IN_PROGRESS", "RESOLVED")).toBe(true);
    expect(canAgentTransition("RESOLVED", "CLOSED")).toBe(true);
  });

  it("no revive estados finales ni salta la aprobacion", () => {
    expect(canAgentTransition("CLOSED", "IN_PROGRESS")).toBe(false);
    expect(canAgentTransition("CANCELLED", "NEW")).toBe(false);
    expect(canAgentTransition("PENDING_APPROVAL", "IN_PROGRESS")).toBe(false);
    expect(canAgentTransition("NEW", "RESOLVED")).toBe(false);
  });

  it("el solicitante solo anula antes de que se trabaje", () => {
    expect(canRequesterCancel("NEW")).toBe(true);
    expect(canRequesterCancel("IN_PROGRESS")).toBe(false);
    expect(canRequesterCancel("RESOLVED")).toBe(false);
  });
});

describe("matriz de prioridad", () => {
  it("impacto y urgencia altos = P1, bajos = P4", () => {
    expect(resolvePriority(MATRIX, 1, 1)).toBe("P1");
    expect(resolvePriority(MATRIX, 2, 2)).toBe("P3");
    expect(resolvePriority(MATRIX, 3, 3)).toBe("P4");
  });

  it("una combinacion sin fila cae en P4", () => {
    expect(resolvePriority(new Map(), 1, 1)).toBe("P4");
  });
});

describe("campos dinamicos del catalogo", () => {
  const fields = catalogFieldsSchema.parse([
    { key: "software", label: "Software", type: "text", required: true },
    { key: "licencias", label: "Licencias", type: "number" },
    { key: "sistema", label: "Sistema", type: "select", options: ["ERP", "Correo"], required: true },
    { key: "desde", label: "Desde", type: "date" },
  ]);
  const schema = buildVariablesSchema(fields);

  it("acepta respuestas validas", () => {
    expect(schema.safeParse({ software: "Office", sistema: "ERP", desde: "2026-10-01" }).success).toBe(true);
  });

  it("rechaza obligatorios vacios, opciones fuera de la lista y claves desconocidas", () => {
    expect(schema.safeParse({ software: " ", sistema: "ERP" }).success).toBe(false);
    expect(schema.safeParse({ software: "Office", sistema: "Otro" }).success).toBe(false);
    expect(schema.safeParse({ software: "Office", sistema: "ERP", extra: 1 }).success).toBe(false);
  });

  it("rechaza definiciones invalidas", () => {
    expect(catalogFieldsSchema.safeParse([{ key: "a", label: "A", type: "select" }]).success).toBe(false);
    expect(
      catalogFieldsSchema.safeParse([
        { key: "a", label: "A", type: "text" },
        { key: "a", label: "B", type: "text" },
      ]).success,
    ).toBe(false);
  });
});
