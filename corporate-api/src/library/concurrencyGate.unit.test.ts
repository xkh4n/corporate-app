import { describe, expect, it } from "vitest";
import { createConcurrencyGate } from "./concurrencyGate";

describe("createConcurrencyGate", () => {
  it("respeta el tope por clave y el tope total", () => {
    const gate = createConcurrencyGate({ maxTotal: 3, maxPerKey: 2 });

    const a1 = gate.tryAcquire("a");
    const a2 = gate.tryAcquire("a");
    expect(a1).not.toBeNull();
    expect(a2).not.toBeNull();
    // Tercera de la misma clave: tope por clave.
    expect(gate.tryAcquire("a")).toBeNull();

    const b1 = gate.tryAcquire("b");
    expect(b1).not.toBeNull();
    // Cuarta en total: tope total.
    expect(gate.tryAcquire("c")).toBeNull();
    expect(gate.inFlight()).toBe(3);
  });

  it("liberar devuelve el cupo y es idempotente", () => {
    const gate = createConcurrencyGate({ maxTotal: 2, maxPerKey: 1 });
    const release = gate.tryAcquire("a")!;
    expect(gate.tryAcquire("a")).toBeNull();

    release();
    release();
    expect(gate.inFlight()).toBe(0);
    expect(gate.tryAcquire("a")).not.toBeNull();
  });
});
