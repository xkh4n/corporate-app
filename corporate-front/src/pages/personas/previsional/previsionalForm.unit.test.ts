import { describe, expect, it } from "vitest";
import type { PrevisionalInstitution } from "../../../types";
import {
  emptyPrevisionalForm,
  isIsapre,
  toHealthInput,
  toPensionInput,
  validateHealth,
  type PrevisionalFormState,
} from "./previsionalForm";

function institution(id: number, previredCode: string): PrevisionalInstitution {
  return {
    id,
    type: "SALUD",
    code: `S${id}`,
    name: `Salud ${id}`,
    nationalId: null,
    previredCode,
    address: null,
    phone: null,
    legalRepresentative: null,
    isActive: true,
  };
}

const FONASA = institution(1, "07");
const ISAPRE = institution(2, "01");
const INSTITUTIONS = [FONASA, ISAPRE];

function form(over: Partial<PrevisionalFormState> = {}): PrevisionalFormState {
  return { ...emptyPrevisionalForm(), ...over };
}

describe("toPensionInput", () => {
  it("regimen AFP exige la AFP y la envia como numero", () => {
    expect(() => toPensionInput(form({ afpId: "" }))).toThrow("AFP");
    expect(toPensionInput(form({ afpId: "5", workerType: 3 }))).toEqual({
      regime: "AFP",
      workerType: 3,
      afpInstitutionId: 5,
    });
  });

  it("IPS y SIP no llevan AFP aunque quedara una elegida antes de cambiar el regimen", () => {
    expect(toPensionInput(form({ regime: "INP", afpId: "5" })).afpInstitutionId).toBeNull();
    expect(toPensionInput(form({ regime: "SIP", afpId: "5" })).afpInstitutionId).toBeNull();
  });
});

describe("isIsapre", () => {
  it("FONASA no es Isapre; una institucion sin elegir tampoco", () => {
    expect(isIsapre("1", INSTITUTIONS)).toBe(false);
    expect(isIsapre("2", INSTITUTIONS)).toBe(true);
    expect(isIsapre("", INSTITUTIONS)).toBe(false);
  });
});

describe("toHealthInput", () => {
  it("exige elegir la institucion", () => {
    expect(() => toHealthInput(form(), INSTITUTIONS)).toThrow("salud");
  });

  it("FONASA no lleva plan: descarta FUN, moneda y monto que hubieran quedado", () => {
    const input = toHealthInput(
      form({ healthInstitutionId: "1", healthFun: "123", healthAgreedAmount: "4" }),
      INSTITUTIONS,
    );
    expect(input).toEqual({
      healthInstitutionId: 1,
      healthFun: null,
      healthPlanCurrency: null,
      healthAgreedAmount: null,
    });
  });

  it("Isapre lleva plan pactado; el FUN vacio se envia como null", () => {
    const input = toHealthInput(
      form({ healthInstitutionId: "2", healthFun: "  ", healthCurrency: 2, healthAgreedAmount: "4.0241" }),
      INSTITUTIONS,
    );
    expect(input).toEqual({
      healthInstitutionId: 2,
      healthFun: null,
      healthPlanCurrency: 2,
      healthAgreedAmount: 4.0241,
    });
  });

  it("Isapre sin monto o con monto no positivo se rechaza", () => {
    const base = { healthInstitutionId: "2" };
    expect(() => validateHealth(form({ ...base, healthAgreedAmount: "" }), INSTITUTIONS)).toThrow("monto");
    expect(() => validateHealth(form({ ...base, healthAgreedAmount: "0" }), INSTITUTIONS)).toThrow("monto");
    expect(() => validateHealth(form({ ...base, healthAgreedAmount: "-3" }), INSTITUTIONS)).toThrow("monto");
  });

  it("el tope de 100 UF aplica solo a UF, no a pesos", () => {
    const base = { healthInstitutionId: "2", healthAgreedAmount: "150" };
    expect(() => validateHealth(form({ ...base, healthCurrency: 2 }), INSTITUTIONS)).toThrow("100 UF");
    expect(validateHealth(form({ ...base, healthCurrency: 1 }), INSTITUTIONS)).toBe(150);
  });
});
