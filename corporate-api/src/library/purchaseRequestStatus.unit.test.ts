import { describe, expect, it } from "vitest";
import { ConflictError } from "./errors";
import {
  assertPurchaseRequestTransition,
  PURCHASE_REQUEST_STATUSES,
  PURCHASE_REQUEST_TRANSITIONS,
} from "./purchaseRequestStatus";

describe("PURCHASE_REQUEST_TRANSITIONS", () => {
  it("cada transicion declarada en la tabla es valida (no lanza)", () => {
    for (const from of PURCHASE_REQUEST_STATUSES) {
      for (const to of PURCHASE_REQUEST_TRANSITIONS[from]) {
        expect(() => assertPurchaseRequestTransition(from, to)).not.toThrow();
      }
    }
  });

  it("cada transicion NO listada lanza ConflictError", () => {
    for (const from of PURCHASE_REQUEST_STATUSES) {
      const allowed = new Set(PURCHASE_REQUEST_TRANSITIONS[from]);
      for (const to of PURCHASE_REQUEST_STATUSES) {
        if (to === from || allowed.has(to)) continue;
        expect(() => assertPurchaseRequestTransition(from, to)).toThrow(ConflictError);
      }
    }
  });

  it("from === to es un no-op idempotente incluso para estados terminales", () => {
    expect(() => assertPurchaseRequestTransition("CANCELLED", "CANCELLED")).not.toThrow();
    expect(() => assertPurchaseRequestTransition("CLOSED", "CLOSED")).not.toThrow();
    expect(() => assertPurchaseRequestTransition("DRAFT", "DRAFT")).not.toThrow();
  });

  it("todo estado no terminal puede cancelarse", () => {
    const terminal = new Set(["REJECTED", "CANCELLED", "CLOSED"]);
    for (const from of PURCHASE_REQUEST_STATUSES) {
      if (terminal.has(from)) continue;
      expect(() => assertPurchaseRequestTransition(from, "CANCELLED")).not.toThrow();
    }
  });

  it("los estados terminales no permiten salir a CANCELLED", () => {
    expect(() => assertPurchaseRequestTransition("REJECTED", "CANCELLED")).toThrow(ConflictError);
    expect(() => assertPurchaseRequestTransition("CLOSED", "CANCELLED")).toThrow(ConflictError);
  });

  it("APPROVE_QUOTE puede reabrirse a IN_QUOTATION o rechazarse directo", () => {
    expect(() => assertPurchaseRequestTransition("APPROVE_QUOTE", "IN_QUOTATION")).not.toThrow();
    expect(() => assertPurchaseRequestTransition("APPROVE_QUOTE", "REJECTED")).not.toThrow();
  });

  it("CLOSED es alcanzable desde AVAILABLE y desde DELIVERED", () => {
    expect(() => assertPurchaseRequestTransition("AVAILABLE", "CLOSED")).not.toThrow();
    expect(() => assertPurchaseRequestTransition("DELIVERED", "CLOSED")).not.toThrow();
  });
});
