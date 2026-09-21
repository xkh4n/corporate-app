import { createValidationError } from "../../../lib/Errors/CustomError";
import type {
  EmployeeContractCreateInput,
  EmployeeContractType,
  GratificationMethod,
  GratificationPaymentMode,
  GratificationType,
} from "../../../types";

// Estado del formulario de contrato/gratificacion. Todo string (lo que entrega
// un <input>); se convierte a numeros solo al validar, en toContractInput.
export interface ContractFormState {
  contractType: EmployeeContractType;
  startDate: string;
  endDate: string;
  baseSalary: string;
  gratificationType: GratificationType;
  method: GratificationMethod;
  percentage: string;
  capEnabled: boolean;
  capFactor: string;
  paymentMode: GratificationPaymentMode;
  settlementMonth: string;
  // Pesos anticipados cada mes; solo con ANTICIPO_MENSUAL_RELIQUIDACION.
  monthlyAdvance: string;
  // true mientras el anticipo sigue el % que define la empresa (se recalcula al
  // cambiar el sueldo); pasa a false cuando el usuario escribe un monto propio.
  advanceLinked: boolean;
  adjustCpi: boolean;
}

// Valores fijados por ley -espejo de assertGratificationRules en
// corporate-api/src/services/mssql/employeeContract.service.ts. El backend es
// quien manda; aca se replican solo para bloquear los campos y evitar el viaje.
const ART50_PERCENTAGE = 25;
const ART50_CAP_FACTOR = 4.75;
const ART47_PERCENTAGE = 30;

export const GRATIFICATION_TYPE_LABELS: Record<GratificationType, string> = {
  ART47: "Art. 47 - Participación en utilidades",
  ART50: "Art. 50 - 25% de las remuneraciones",
  CONVENCIONAL: "Convencional (pactada en el contrato)",
};

export const PAYMENT_MODE_LABELS: Record<GratificationPaymentMode, string> = {
  MENSUAL: "Mensual",
  ANTICIPO_MENSUAL_RELIQUIDACION: "Anticipos mensuales y reliquidación",
  ANUAL: "Anual (un solo pago)",
};

export const MONTH_LABELS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

// Que campos quedan fijos segun el tipo: ART50 fija porcentaje y tope, ART47
// fija el porcentaje, CONVENCIONAL es libre. El metodo no se elige: lo define
// el tipo (ver applyGratificationType).
export function lockedFields(type: GratificationType): { percentage: boolean; cap: boolean } {
  return {
    percentage: type !== "CONVENCIONAL",
    cap: type === "ART50",
  };
}

// Valores por defecto al elegir un tipo. Lo que la ley no fija (mes de
// reliquidacion en ART47, porcentaje convencional) queda vacio para que lo
// complete el usuario en vez de inventarlo.
export function applyGratificationType(state: ContractFormState, type: GratificationType): ContractFormState {
  const base = { ...state, gratificationType: type };
  switch (type) {
    case "ART50":
      return {
        ...base,
        method: "PORCENTAJE_REMUNERACIONES",
        percentage: String(ART50_PERCENTAGE),
        capEnabled: true,
        capFactor: String(ART50_CAP_FACTOR),
        paymentMode: "ANTICIPO_MENSUAL_RELIQUIDACION",
        settlementMonth: "12",
        // El monto lo define el usuario: depende de cuanto quiera anticipar.
        monthlyAdvance: "",
        advanceLinked: true,
        adjustCpi: true,
      };
    case "ART47":
      return {
        ...base,
        method: "PARTICIPACION_UTILIDADES",
        percentage: String(ART47_PERCENTAGE),
        capEnabled: true,
        capFactor: String(ART50_CAP_FACTOR),
        paymentMode: "ANUAL",
        settlementMonth: "",
        monthlyAdvance: "",
        advanceLinked: true,
        adjustCpi: false,
      };
    case "CONVENCIONAL":
      return {
        ...base,
        method: "PORCENTAJE_REMUNERACIONES",
        percentage: "",
        capEnabled: false,
        capFactor: "",
        paymentMode: "MENSUAL",
        settlementMonth: "",
        monthlyAdvance: "",
        advanceLinked: true,
        adjustCpi: false,
      };
  }
}

// Referencia para el anticipo mensual: el porcentaje de gratificacion sobre el
// sueldo base. Es solo una orientacion -la gratificacion real se calcula sobre
// TODAS las remuneraciones del mes y tiene el tope anual del tipo elegido-, por
// eso la reliquidacion final cuadra la diferencia. null si faltan datos.
export function suggestedMonthlyAdvance(state: ContractFormState): number | null {
  const salary = toNumber(state.baseSalary);
  const percentage = toNumber(state.percentage);
  if (!Number.isFinite(salary) || salary <= 0 || !Number.isFinite(percentage) || percentage <= 0) return null;
  return Math.round((salary * percentage) / 100);
}

// Anticipo en pesos segun el % de la empresa sobre el sueldo base. null si
// falta un sueldo valido.
export function companyAdvanceAmount(baseSalary: string, percentage: number): number | null {
  const salary = toNumber(baseSalary);
  if (!Number.isFinite(salary) || salary <= 0 || percentage <= 0) return null;
  return Math.round((salary * percentage) / 100);
}

// Mientras el anticipo siga "enlazado" al % de la empresa, lo recalcula desde el
// sueldo base (vacio si aun no hay un sueldo valido). Sin % de la empresa, con
// otro modo de pago o con un monto escrito a mano, no toca nada.
export function syncCompanyAdvance(state: ContractFormState, companyPercentage: number | null): ContractFormState {
  if (companyPercentage === null || state.paymentMode !== "ANTICIPO_MENSUAL_RELIQUIDACION" || !state.advanceLinked) {
    return state;
  }
  const amount = companyAdvanceAmount(state.baseSalary, companyPercentage);
  return { ...state, monthlyAdvance: amount === null ? "" : String(amount) };
}

export function emptyContractForm(type: GratificationType = "ART50"): ContractFormState {
  return applyGratificationType(
    {
      contractType: "INDEFINIDO",
      startDate: "",
      endDate: "",
      baseSalary: "",
      gratificationType: type,
      method: "PORCENTAJE_REMUNERACIONES",
      percentage: "",
      capEnabled: false,
      capFactor: "",
      paymentMode: "MENSUAL",
      settlementMonth: "",
      monthlyAdvance: "",
      advanceLinked: true,
      adjustCpi: false,
    },
    type,
  );
}

// Cambiar la forma de pago limpia lo que deja de aplicar (mes, monto anticipado
// y reajuste IPC).
export function applyPaymentMode(state: ContractFormState, mode: GratificationPaymentMode): ContractFormState {
  return {
    ...state,
    paymentMode: mode,
    settlementMonth: mode === "MENSUAL" ? "" : state.settlementMonth,
    monthlyAdvance: mode === "ANTICIPO_MENSUAL_RELIQUIDACION" ? state.monthlyAdvance : "",
    // Al volver a anticipos el monto se recalcula desde el % de la empresa.
    advanceLinked: mode === "ANTICIPO_MENSUAL_RELIQUIDACION" ? state.advanceLinked : true,
    adjustCpi: mode === "ANTICIPO_MENSUAL_RELIQUIDACION" ? state.adjustCpi : false,
  };
}

function toNumber(raw: string): number {
  return raw.trim() === "" ? NaN : Number(raw);
}

// Valida y convierte. Lanza createValidationError con un mensaje pensado para
// el usuario; el backend vuelve a validar todo (esto solo ahorra el viaje).
export function toContractInput(state: ContractFormState, employeeId: number): EmployeeContractCreateInput {
  const salary = toNumber(state.baseSalary);
  if (!Number.isInteger(salary) || salary <= 0) {
    throw createValidationError("El sueldo base debe ser un monto entero en pesos, mayor a cero");
  }
  if (!state.startDate) throw createValidationError("Debe indicar la fecha de inicio del contrato");
  if (state.contractType === "PLAZO_FIJO" && !state.endDate) {
    throw createValidationError("Un contrato a plazo fijo requiere fecha de término");
  }
  if (state.endDate && state.endDate < state.startDate) {
    throw createValidationError("La fecha de término no puede ser anterior a la de inicio");
  }

  const percentage = toNumber(state.percentage);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
    throw createValidationError("El porcentaje de gratificación debe estar entre 0 y 100");
  }

  let capFactor: number | null = null;
  if (state.capEnabled) {
    capFactor = toNumber(state.capFactor);
    if (!Number.isFinite(capFactor) || capFactor <= 0) {
      throw createValidationError("El tope de la gratificación (veces el IMM) debe ser mayor a cero");
    }
  }

  let settlementMonth: number | null = null;
  if (state.paymentMode !== "MENSUAL") {
    settlementMonth = toNumber(state.settlementMonth);
    if (!Number.isInteger(settlementMonth) || settlementMonth < 1 || settlementMonth > 12) {
      throw createValidationError("Debe seleccionar el mes de reliquidación o de pago de la gratificación");
    }
  }

  let monthlyAdvance: number | null = null;
  if (state.paymentMode === "ANTICIPO_MENSUAL_RELIQUIDACION") {
    monthlyAdvance = toNumber(state.monthlyAdvance);
    if (!Number.isInteger(monthlyAdvance) || monthlyAdvance <= 0) {
      throw createValidationError("El anticipo mensual debe ser un monto entero en pesos, mayor a cero");
    }
  }

  return {
    employeeId,
    contractType: state.contractType,
    startDate: state.startDate,
    endDate: state.endDate || null,
    baseSalary: salary,
    gratificationType: state.gratificationType,
    gratificationMethod: state.method,
    gratificationPercentage: percentage,
    gratificationCapType: state.capEnabled ? "IMM" : null,
    gratificationCapFactor: capFactor,
    gratificationPaymentMode: state.paymentMode,
    gratificationSettlementMonth: settlementMonth,
    gratificationMonthlyAdvance: monthlyAdvance,
    gratificationAdjustAdvancesCpi: state.adjustCpi,
  };
}

// Estructura de la gratificacion tal como se le presenta al usuario para que
// confirme lo que quedara guardado. null si todavia hay campos incompletos.
export function gratificationSummary(state: ContractFormState): object | null {
  const percentage = toNumber(state.percentage);
  if (!Number.isFinite(percentage)) return null;
  return {
    tipo: state.gratificationType,
    metodo: state.method,
    porcentaje: percentage,
    ...(state.capEnabled ? { tope: { tipo: "IMM", factor: toNumber(state.capFactor) || null } } : {}),
    pago: {
      modalidad: state.paymentMode,
      ...(state.paymentMode !== "MENSUAL" ? { mes_reliquidacion: toNumber(state.settlementMonth) || null } : {}),
      ...(state.paymentMode === "ANTICIPO_MENSUAL_RELIQUIDACION"
        ? { anticipo_mensual: toNumber(state.monthlyAdvance) || null }
        : {}),
      reajustar_anticipos_ipc: state.adjustCpi,
    },
  };
}
