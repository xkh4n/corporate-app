import { describe, expect, it } from "vitest";
import { normalizeRut } from "./rut";
import { roomAccessPeriodError } from "./serviceDesk/ticketRules";

describe("normalizeRut (plan 016)", () => {
  it("quita puntos y espacios, y deja la K en mayuscula", () => {
    expect(normalizeRut("12.345.678-k")).toBe("12345678-K");
    expect(normalizeRut(" 12345678-5 ")).toBe("12345678-5");
  });

  it("agrega el guion si falta", () => {
    expect(normalizeRut("123456785")).toBe("12345678-5");
  });
});

describe("roomAccessPeriodError (plan 016)", () => {
  const from = new Date("2026-10-01T09:00:00-03:00");
  const later = new Date("2026-10-01T18:00:00-03:00");

  it("permanente sin termino; con termino es un error", () => {
    expect(roomAccessPeriodError("PERMANENT", from, null)).toBeNull();
    expect(roomAccessPeriodError("PERMANENT", from, later)).not.toBeNull();
  });

  it("temporal y unica vez exigen un termino posterior al inicio", () => {
    expect(roomAccessPeriodError("TEMPORARY", from, later)).toBeNull();
    expect(roomAccessPeriodError("SINGLE_USE", from, null)).not.toBeNull();
    expect(roomAccessPeriodError("TEMPORARY", later, from)).not.toBeNull();
  });
});
