import { describe, expect, it } from "vitest";
import {
  applyGratificationType,
  applyPaymentMode,
  companyAdvanceAmount,
  emptyContractForm,
  gratificationSummary,
  lockedFields,
  suggestedMonthlyAdvance,
  syncCompanyAdvance,
  toContractInput,
  type ContractFormState,
} from "./contractForm";

// Un formulario ART50 completo y valido; cada test cambia solo lo que prueba.
function validForm(over: Partial<ContractFormState> = {}): ContractFormState {
  return {
    ...emptyContractForm("ART50"),
    startDate: "2026-01-01",
    baseSalary: "1200000",
    monthlyAdvance: "300000",
    ...over,
  };
}

describe("applyGratificationType", () => {
  it("ART50 fija 25%, tope de 4,75 IMM y anticipo con reliquidacion en diciembre con reajuste IPC", () => {
    const form = emptyContractForm("ART50");
    expect(form).toMatchObject({
      method: "PORCENTAJE_REMUNERACIONES",
      percentage: "25",
      capEnabled: true,
      capFactor: "4.75",
      paymentMode: "ANTICIPO_MENSUAL_RELIQUIDACION",
      settlementMonth: "12",
      adjustCpi: true,
    });
  });

  it("ART50 no inventa el anticipo: lo define el usuario", () => {
    expect(emptyContractForm("ART50").monthlyAdvance).toBe("");
  });

  it("ART47 usa participacion en utilidades al 30% y no inventa el mes de pago", () => {
    const form = emptyContractForm("ART47");
    expect(form).toMatchObject({ method: "PARTICIPACION_UTILIDADES", percentage: "30", paymentMode: "ANUAL", settlementMonth: "" });
  });

  it("CONVENCIONAL arranca vacio y sin tope: lo define el usuario", () => {
    expect(emptyContractForm("CONVENCIONAL")).toMatchObject({ percentage: "", capEnabled: false, paymentMode: "MENSUAL" });
  });

  it("cambiar de tipo descarta lo del tipo anterior pero conserva sueldo y fechas", () => {
    const next = applyGratificationType(validForm(), "CONVENCIONAL");
    expect(next.baseSalary).toBe("1200000");
    expect(next.startDate).toBe("2026-01-01");
    expect(next.percentage).toBe("");
  });
});

describe("lockedFields", () => {
  it("ART50 bloquea porcentaje y tope, ART47 solo el porcentaje, CONVENCIONAL nada", () => {
    expect(lockedFields("ART50")).toEqual({ percentage: true, cap: true });
    expect(lockedFields("ART47")).toEqual({ percentage: true, cap: false });
    expect(lockedFields("CONVENCIONAL")).toEqual({ percentage: false, cap: false });
  });
});

describe("applyPaymentMode", () => {
  it("pasar a MENSUAL limpia el mes, el anticipo y el reajuste IPC", () => {
    const next = applyPaymentMode(validForm(), "MENSUAL");
    expect(next).toMatchObject({ paymentMode: "MENSUAL", settlementMonth: "", monthlyAdvance: "", adjustCpi: false });
  });

  it("pasar a ANUAL tambien limpia el anticipo, que solo existe con anticipos mensuales", () => {
    expect(applyPaymentMode(validForm(), "ANUAL").monthlyAdvance).toBe("");
  });

  it("volver a anticipos desde otro modo no arrastra un monto anterior", () => {
    const back = applyPaymentMode(applyPaymentMode(validForm(), "MENSUAL"), "ANTICIPO_MENSUAL_RELIQUIDACION");
    expect(back.monthlyAdvance).toBe("");
  });

  it("pasar a ANUAL conserva el mes pero apaga el reajuste IPC (solo aplica a anticipos)", () => {
    const next = applyPaymentMode(validForm(), "ANUAL");
    expect(next).toMatchObject({ paymentMode: "ANUAL", settlementMonth: "12", adjustCpi: false });
  });
});

describe("toContractInput", () => {
  it("convierte un ART50 valido a la forma que espera la API", () => {
    expect(toContractInput(validForm(), 7)).toEqual({
      employeeId: 7,
      contractType: "INDEFINIDO",
      startDate: "2026-01-01",
      endDate: null,
      baseSalary: 1200000,
      gratificationType: "ART50",
      gratificationMethod: "PORCENTAJE_REMUNERACIONES",
      gratificationPercentage: 25,
      gratificationCapType: "IMM",
      gratificationCapFactor: 4.75,
      gratificationPaymentMode: "ANTICIPO_MENSUAL_RELIQUIDACION",
      gratificationSettlementMonth: 12,
      gratificationMonthlyAdvance: 300000,
      gratificationAdjustAdvancesCpi: true,
    });
  });

  it("sin tope manda tipo y factor en null, juntos", () => {
    const input = toContractInput(
      validForm({ gratificationType: "CONVENCIONAL", percentage: "18", capEnabled: false, capFactor: "", paymentMode: "MENSUAL", settlementMonth: "", adjustCpi: false }),
      1,
    );
    expect(input).toMatchObject({
      gratificationCapType: null,
      gratificationCapFactor: null,
      gratificationSettlementMonth: null,
      gratificationMonthlyAdvance: null,
    });
  });

  it.each([
    ["sueldo vacio", { baseSalary: "" }],
    ["sueldo con decimales", { baseSalary: "1200000.5" }],
    ["sueldo cero", { baseSalary: "0" }],
    ["sin fecha de inicio", { startDate: "" }],
    ["plazo fijo sin termino", { contractType: "PLAZO_FIJO" as const, endDate: "" }],
    ["termino antes del inicio", { endDate: "2025-12-31" }],
    ["porcentaje vacio", { percentage: "" }],
    ["porcentaje sobre 100", { percentage: "101" }],
    ["tope activado sin factor", { capEnabled: true, capFactor: "" }],
    ["reliquidacion sin mes", { settlementMonth: "" }],
    ["mes 13", { settlementMonth: "13" }],
    ["anticipos sin monto", { monthlyAdvance: "" }],
    ["anticipo cero", { monthlyAdvance: "0" }],
    ["anticipo negativo", { monthlyAdvance: "-1" }],
    ["anticipo con decimales", { monthlyAdvance: "1000.5" }],
  ])("rechaza %s", (_name, over) => {
    expect(() => toContractInput(validForm(over), 1)).toThrow();
  });
});

describe("suggestedMonthlyAdvance", () => {
  it("es el porcentaje sobre el sueldo base, redondeado a pesos", () => {
    expect(suggestedMonthlyAdvance(validForm({ baseSalary: "1200000", percentage: "25" }))).toBe(300000);
    expect(suggestedMonthlyAdvance(validForm({ baseSalary: "1000001", percentage: "25" }))).toBe(250000);
  });

  it("es null mientras falte sueldo o porcentaje", () => {
    expect(suggestedMonthlyAdvance(validForm({ baseSalary: "" }))).toBeNull();
    expect(suggestedMonthlyAdvance(validForm({ percentage: "" }))).toBeNull();
  });
});

describe("companyAdvanceAmount", () => {
  it("aplica el % de la empresa al sueldo base, redondeado a pesos", () => {
    expect(companyAdvanceAmount("1200000", 25)).toBe(300000);
    expect(companyAdvanceAmount("1000000", 8.33)).toBe(83300);
    expect(companyAdvanceAmount("1000001", 25)).toBe(250000);
  });

  it("es null sin un sueldo valido", () => {
    expect(companyAdvanceAmount("", 25)).toBeNull();
    expect(companyAdvanceAmount("0", 25)).toBeNull();
    expect(companyAdvanceAmount("abc", 25)).toBeNull();
  });
});

describe("syncCompanyAdvance", () => {
  const linked = (over: Partial<ContractFormState> = {}) => validForm({ monthlyAdvance: "", advanceLinked: true, ...over });

  it("calcula el anticipo desde el sueldo mientras siga enlazado al % de la empresa", () => {
    expect(syncCompanyAdvance(linked({ baseSalary: "1200000" }), 10).monthlyAdvance).toBe("120000");
  });

  it("lo recalcula si el sueldo cambia y lo vacia si el sueldo deja de ser valido", () => {
    const first = syncCompanyAdvance(linked({ baseSalary: "1200000" }), 10);
    expect(syncCompanyAdvance({ ...first, baseSalary: "2000000" }, 10).monthlyAdvance).toBe("200000");
    expect(syncCompanyAdvance({ ...first, baseSalary: "" }, 10).monthlyAdvance).toBe("");
  });

  it("respeta un monto escrito a mano (desenlazado), aunque cambie el sueldo", () => {
    const manual = linked({ baseSalary: "2000000", monthlyAdvance: "111111", advanceLinked: false });
    expect(syncCompanyAdvance(manual, 10)).toBe(manual);
  });

  it("no toca nada sin % de la empresa ni fuera del modo de anticipos", () => {
    const state = linked({ baseSalary: "1200000", monthlyAdvance: "5" });
    expect(syncCompanyAdvance(state, null)).toBe(state);
    const mensual = applyPaymentMode(linked({ baseSalary: "1200000" }), "MENSUAL");
    expect(syncCompanyAdvance(mensual, 10).monthlyAdvance).toBe("");
  });

  it("volver a anticipos desde otro modo vuelve a enlazar con el % de la empresa", () => {
    const manual = validForm({ advanceLinked: false, monthlyAdvance: "999" });
    const back = applyPaymentMode(applyPaymentMode(manual, "MENSUAL"), "ANTICIPO_MENSUAL_RELIQUIDACION");
    expect(back.advanceLinked).toBe(true);
    expect(syncCompanyAdvance(back, 10).monthlyAdvance).toBe("120000");
  });
});

describe("gratificationSummary", () => {
  it("replica la estructura de ejemplo del ART50 (tipo, metodo, porcentaje, tope, pago)", () => {
    expect(gratificationSummary(validForm())).toEqual({
      tipo: "ART50",
      metodo: "PORCENTAJE_REMUNERACIONES",
      porcentaje: 25,
      tope: { tipo: "IMM", factor: 4.75 },
      pago: {
        modalidad: "ANTICIPO_MENSUAL_RELIQUIDACION",
        mes_reliquidacion: 12,
        anticipo_mensual: 300000,
        reajustar_anticipos_ipc: true,
      },
    });
  });

  it("es null mientras falte el porcentaje", () => {
    expect(gratificationSummary(emptyContractForm("CONVENCIONAL"))).toBeNull();
  });
});
