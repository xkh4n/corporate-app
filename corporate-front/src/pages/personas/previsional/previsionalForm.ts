import { createValidationError } from "../../../lib/Errors/CustomError";
import type {
  HealthAssignInput,
  HealthPlanCurrency,
  PensionAssignInput,
  PrevisionalInstitution,
  PrevisionalRegime,
  PrevisionalWorkerType,
} from "../../../types";
import { FONASA_PREVIRED_CODE } from "./constants";

// Tope de la doc de Previred (campo 79): un plan pactado sobre 100 UF se
// rechaza. El backend lo vuelve a validar; aca solo se evita el viaje.
export const MAX_AGREED_UF = 100;

// Estado del formulario de afiliacion (AFP + salud). Todo string donde lo
// entrega un <input>; se convierte a numeros solo al armar el request.
export interface PrevisionalFormState {
  regime: PrevisionalRegime;
  workerType: PrevisionalWorkerType;
  afpId: string;
  healthInstitutionId: string;
  healthFun: string;
  healthCurrency: HealthPlanCurrency;
  healthAgreedAmount: string;
}

export function emptyPrevisionalForm(): PrevisionalFormState {
  return {
    regime: "AFP",
    workerType: 0,
    afpId: "",
    healthInstitutionId: "",
    healthFun: "",
    healthCurrency: 2,
    healthAgreedAmount: "",
  };
}

// FONASA no tiene plan pactado (es el 7% de la renta): los datos de plan solo
// aplican a una Isapre.
export function isIsapre(healthInstitutionId: string, healthInstitutions: PrevisionalInstitution[]): boolean {
  const selected = healthInstitutions.find((item) => String(item.id) === healthInstitutionId);
  return !!selected && selected.previredCode !== FONASA_PREVIRED_CODE;
}

export function validatePension(state: Pick<PrevisionalFormState, "regime" | "afpId">): void {
  if (state.regime === "AFP" && !state.afpId) throw createValidationError("Debe seleccionar la AFP");
}

// Devuelve el monto pactado ya numerico (null para FONASA) para no reparsearlo.
export function validateHealth(
  state: Pick<PrevisionalFormState, "healthInstitutionId" | "healthCurrency" | "healthAgreedAmount">,
  healthInstitutions: PrevisionalInstitution[],
): number | null {
  if (!state.healthInstitutionId) throw createValidationError("Debe seleccionar la institución de salud");
  if (!isIsapre(state.healthInstitutionId, healthInstitutions)) return null;

  const amount = Number(state.healthAgreedAmount);
  if (!state.healthAgreedAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
    throw createValidationError("Debe indicar el monto del plan pactado");
  }
  if (state.healthCurrency === 2 && amount > MAX_AGREED_UF) {
    throw createValidationError(`El plan pactado no puede superar ${MAX_AGREED_UF} UF`);
  }
  return amount;
}

// Solo el regimen AFP lleva AFP; en IPS/SIP el backend descarta la AFP.
export function toPensionInput(state: PrevisionalFormState): PensionAssignInput {
  validatePension(state);
  return {
    regime: state.regime,
    workerType: state.workerType,
    afpInstitutionId: state.regime === "AFP" ? Number(state.afpId) : null,
  };
}

export function toHealthInput(state: PrevisionalFormState, healthInstitutions: PrevisionalInstitution[]): HealthAssignInput {
  const amount = validateHealth(state, healthInstitutions);
  const isapre = isIsapre(state.healthInstitutionId, healthInstitutions);
  return {
    healthInstitutionId: Number(state.healthInstitutionId),
    healthFun: isapre && state.healthFun.trim() ? state.healthFun.trim() : null,
    healthPlanCurrency: isapre ? state.healthCurrency : null,
    healthAgreedAmount: amount,
  };
}
