import { describe, expect, it } from "vitest";
import { addBusinessMinutes, businessMinutesBetween, type BusinessCalendar } from "./businessTime";

// Lunes a viernes 09:00-18:00 en Santiago. Chile: UTC-3 en verano, UTC-4 en
// invierno (2026: invierno desde el domingo 5 de abril, verano desde el
// domingo 6 de septiembre).
const WEEKDAYS: BusinessCalendar["hours"] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "18:00" }));
const CALENDAR: BusinessCalendar = { timezone: "America/Santiago", hours: WEEKDAYS, holidays: [] };

const at = (iso: string) => new Date(iso);

describe("addBusinessMinutes", () => {
  it("dentro del mismo tramo", () => {
    // Miercoles 2026-06-10 10:00 local (UTC-4) = 14:00Z.
    expect(addBusinessMinutes(at("2026-06-10T14:00:00Z"), 90, CALENDAR).toISOString()).toBe("2026-06-10T15:30:00.000Z");
  });

  it("fuera de horario arranca en el proximo tramo", () => {
    // Miercoles 20:00 local -> jueves 09:00 + 30 min.
    expect(addBusinessMinutes(at("2026-06-11T00:00:00Z"), 30, CALENDAR).toISOString()).toBe("2026-06-11T13:30:00.000Z");
  });

  it("salta el fin de semana", () => {
    // Viernes 2026-06-12 17:00 local + 2 h -> lunes 10:00 local (14:00Z).
    expect(addBusinessMinutes(at("2026-06-12T21:00:00Z"), 120, CALENDAR).toISOString()).toBe("2026-06-15T14:00:00.000Z");
  });

  it("salta feriados", () => {
    const calendar = { ...CALENDAR, holidays: ["2026-06-15"] };
    expect(addBusinessMinutes(at("2026-06-12T21:00:00Z"), 120, calendar).toISOString()).toBe("2026-06-16T14:00:00.000Z");
  });

  it("cruza el cambio a horario de invierno (abril)", () => {
    // Viernes 2026-04-03 17:00 local (UTC-3 = 20:00Z) + 2 h -> lunes 6 10:00 local (UTC-4 = 14:00Z).
    expect(addBusinessMinutes(at("2026-04-03T20:00:00Z"), 120, CALENDAR).toISOString()).toBe("2026-04-06T14:00:00.000Z");
  });

  it("cruza el cambio a horario de verano (septiembre)", () => {
    // Viernes 2026-09-04 17:00 local (UTC-4 = 21:00Z) + 2 h -> lunes 7 10:00 local (UTC-3 = 13:00Z).
    expect(addBusinessMinutes(at("2026-09-04T21:00:00Z"), 120, CALENDAR).toISOString()).toBe("2026-09-07T13:00:00.000Z");
  });

  it("respeta varios tramos en el dia (colacion)", () => {
    const hours = [1, 2, 3, 4, 5].flatMap((weekday) => [
      { weekday, start: "09:00", end: "13:00" },
      { weekday, start: "14:00", end: "18:00" },
    ]);
    const calendar = { ...CALENDAR, hours };
    // Miercoles 12:30 local + 60 min -> 14:30 local (18:30Z).
    expect(addBusinessMinutes(at("2026-06-10T16:30:00Z"), 60, calendar).toISOString()).toBe("2026-06-10T18:30:00.000Z");
  });

  it("falla con un calendario sin horario", () => {
    expect(() => addBusinessMinutes(at("2026-06-10T14:00:00Z"), 10, { ...CALENDAR, hours: [] })).toThrow(RangeError);
  });
});

describe("businessMinutesBetween", () => {
  it("cuenta solo el horario habil", () => {
    // Viernes 17:00 local -> lunes 10:00 local = 60 + 60.
    expect(businessMinutesBetween(at("2026-06-12T21:00:00Z"), at("2026-06-15T14:00:00Z"), CALENDAR)).toBe(120);
  });

  it("es 0 si el fin es anterior al inicio", () => {
    expect(businessMinutesBetween(at("2026-06-15T14:00:00Z"), at("2026-06-12T21:00:00Z"), CALENDAR)).toBe(0);
  });

  it("es la inversa de addBusinessMinutes", () => {
    const start = at("2026-04-02T15:17:00Z");
    for (const minutes of [0, 45, 540, 1000, 5000]) {
      const due = addBusinessMinutes(start, minutes, CALENDAR);
      expect(businessMinutesBetween(start, due, CALENDAR)).toBe(minutes);
    }
  });
});
