import { describe, expect, it } from "vitest";
import { assertCompanyAdvancePercentage, assertGratificationRules, type GratificationRuleInput } from "./gratificationRules";
import { BadRequestError } from "./errors";

const art50: GratificationRuleInput = {
  gratificationType: "ART50",
  gratificationMethod: "PORCENTAJE_REMUNERACIONES",
  gratificationPercentage: 25,
  gratificationCapType: "IMM",
  gratificationCapFactor: 4.75,
};

describe("assertGratificationRules", () => {
  it("acepta ART50 con 25% y tope de 4,75 IMM", () => {
    expect(() => assertGratificationRules(art50)).not.toThrow();
  });

  it.each([
    ["20% en vez de 25%", { gratificationPercentage: 20 }, /25%/],
    ["sin tope", { gratificationCapType: null, gratificationCapFactor: null }, /4.75 IMM/],
    ["tope de 5 IMM", { gratificationCapFactor: 5 }, /4.75 IMM/],
    ["metodo de utilidades", { gratificationMethod: "PARTICIPACION_UTILIDADES" as const }, /porcentaje de las remuneraciones/],
  ])("rechaza ART50 con %s", (_name, over, message) => {
    expect(() => assertGratificationRules({ ...art50, ...over })).toThrow(message);
  });

  it("lanza BadRequestError (400), no un error generico", () => {
    expect(() => assertGratificationRules({ ...art50, gratificationPercentage: 1 })).toThrow(BadRequestError);
  });

  it("ART47 exige participacion en utilidades al 30%; el tope es libre", () => {
    const art47: GratificationRuleInput = {
      gratificationType: "ART47",
      gratificationMethod: "PARTICIPACION_UTILIDADES",
      gratificationPercentage: 30,
      gratificationCapType: null,
      gratificationCapFactor: null,
    };
    expect(() => assertGratificationRules(art47)).not.toThrow();
    expect(() => assertGratificationRules({ ...art47, gratificationMethod: "PORCENTAJE_REMUNERACIONES" })).toThrow(/utilidades/);
    expect(() => assertGratificationRules({ ...art47, gratificationPercentage: 25 })).toThrow(/30%/);
  });

  it("CONVENCIONAL admite cualquier porcentaje y tope, pero solo como porcentaje de remuneraciones", () => {
    const convencional: GratificationRuleInput = {
      gratificationType: "CONVENCIONAL",
      gratificationMethod: "PORCENTAJE_REMUNERACIONES",
      gratificationPercentage: 18,
      gratificationCapType: null,
      gratificationCapFactor: null,
    };
    expect(() => assertGratificationRules(convencional)).not.toThrow();
    expect(() =>
      assertGratificationRules({ ...convencional, gratificationMethod: "PARTICIPACION_UTILIDADES" }),
    ).toThrow(/porcentaje de las remuneraciones/);
  });
});

describe("assertCompanyAdvancePercentage", () => {
  it("sin porcentaje siempre es valido, con cualquier sistema", () => {
    for (const system of [null, "ART47", "ART50", "CONVENCIONAL"] as const) {
      expect(() => assertCompanyAdvancePercentage(system, null)).not.toThrow();
    }
  });

  it("ART50 admite hasta el 25% legal, inclusive", () => {
    expect(() => assertCompanyAdvancePercentage("ART50", 8.33)).not.toThrow();
    expect(() => assertCompanyAdvancePercentage("ART50", 25)).not.toThrow();
    expect(() => assertCompanyAdvancePercentage("ART50", 25.01)).toThrow(/25%/);
  });

  it("CONVENCIONAL solo se acota a 100%: el porcentaje pactado es de cada contrato", () => {
    expect(() => assertCompanyAdvancePercentage("CONVENCIONAL", 40)).not.toThrow();
    expect(() => assertCompanyAdvancePercentage("CONVENCIONAL", 100.5)).toThrow(/100%/);
  });

  it("ART47 no lleva anticipo mensual", () => {
    expect(() => assertCompanyAdvancePercentage("ART47", 10)).toThrow(/ART47/);
  });

  it("exige definir el sistema antes de indicar un porcentaje", () => {
    expect(() => assertCompanyAdvancePercentage(null, 10)).toThrow(/sistema/);
  });

  it.each([0, -5])("rechaza %s%%", (value) => {
    expect(() => assertCompanyAdvancePercentage("ART50", value)).toThrow(BadRequestError);
  });
});
