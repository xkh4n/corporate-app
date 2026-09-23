import { describe, expect, it } from "vitest";
import { addMonths, buildSchedule, effectiveLifeMonths, monthlyInstallment, monthsBetween } from "./depreciation";

describe("depreciation", () => {
  it("lineal: cuota constante y el valor libro termina en el residual", () => {
    const schedule = buildSchedule({ cost: 1200, residual: 0, lifeMonths: 12, method: "LINEAR" }, "2026-10");
    expect(schedule).toHaveLength(12);
    expect(schedule.every((row) => row.amount === 100)).toBe(true);
    expect(schedule.at(-1)).toMatchObject({ period: "2027-09", accumulated: 1200, bookValue: 0 });
  });

  it("la ultima cuota absorbe el redondeo", () => {
    const schedule = buildSchedule({ cost: 1000, residual: 0, lifeMonths: 3, method: "LINEAR" }, "2026-01");
    expect(schedule.map((row) => row.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(schedule.at(-1)?.bookValue).toBe(0);
  });

  it("respeta el valor residual", () => {
    const schedule = buildSchedule({ cost: 1100, residual: 100, lifeMonths: 10, method: "LINEAR" }, "2026-01");
    expect(schedule).toHaveLength(10);
    expect(schedule.at(-1)).toMatchObject({ accumulated: 1000, bookValue: 100 });
  });

  it("acelerada SII: un tercio de la vida util, redondeando hacia arriba", () => {
    expect(effectiveLifeMonths(72, "ACCELERATED")).toBe(24);
    expect(effectiveLifeMonths(10, "ACCELERATED")).toBe(4);
    expect(effectiveLifeMonths(1, "ACCELERATED")).toBe(1);
    const schedule = buildSchedule({ cost: 2400, residual: 0, lifeMonths: 72, method: "ACCELERATED" }, "2026-01");
    expect(schedule).toHaveLength(24);
    expect(schedule[0]?.amount).toBe(100);
  });

  it("no deprecia de mas: sin remanente la cuota es 0", () => {
    const params = { cost: 1200, residual: 0, lifeMonths: 12, method: "LINEAR" as const };
    expect(monthlyInstallment(params, 1200, 12)).toBe(0);
    expect(monthlyInstallment(params, 1150, 5)).toBe(50);
  });

  it("aritmetica de periodos", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthsBetween("2026-10", "2027-01")).toBe(3);
    expect(monthsBetween("2026-10", "2026-10")).toBe(0);
  });
});
