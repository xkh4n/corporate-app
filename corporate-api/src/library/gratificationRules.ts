import { BadRequestError } from "./errors";
import type {
  GratificationCapType,
  GratificationMethod,
} from "../models/mssql/employeeContract.model";
import type { GratificationType } from "../models/mssql/payrollSettings.model";

// Solo los campos que las reglas leen: asi se prueba sin armar un contrato
// completo ni tocar la BD.
export interface GratificationRuleInput {
  gratificationType: GratificationType;
  gratificationMethod: GratificationMethod;
  gratificationPercentage: number;
  gratificationCapType: GratificationCapType | null;
  gratificationCapFactor: number | null;
}

// Valores fijados por ley. ART50: la empresa paga el 25% de las remuneraciones
// mensuales devengadas con tope de 4,75 IMM. ART47: 30% de las utilidades. Se
// validan aca y no en un CHECK de la BD para poder ajustarlos si cambian sin
// una migracion.
const ART50_PERCENTAGE = 25;
const ART50_CAP_FACTOR = 4.75;
const ART47_PERCENTAGE = 30;

// La gratificacion se define POR CONTRATO (el de la empresa solo pre-llena el
// alta), asi que un contrato no puede declarar un tipo con parametros que ese
// tipo no admite: ART50 con 20% dejaria de ser ART50.
export function assertGratificationRules(data: GratificationRuleInput): void {
  switch (data.gratificationType) {
    case "ART50":
      if (data.gratificationMethod !== "PORCENTAJE_REMUNERACIONES") {
        throw new BadRequestError("ART50 se calcula como porcentaje de las remuneraciones");
      }
      if (data.gratificationPercentage !== ART50_PERCENTAGE) {
        throw new BadRequestError(`ART50 es el ${ART50_PERCENTAGE}% de las remuneraciones`);
      }
      if (data.gratificationCapType !== "IMM" || data.gratificationCapFactor !== ART50_CAP_FACTOR) {
        throw new BadRequestError(`ART50 tiene un tope de ${ART50_CAP_FACTOR} IMM`);
      }
      break;
    case "ART47":
      if (data.gratificationMethod !== "PARTICIPACION_UTILIDADES") {
        throw new BadRequestError("ART47 se calcula como participacion en las utilidades");
      }
      if (data.gratificationPercentage !== ART47_PERCENTAGE) {
        throw new BadRequestError(`ART47 es el ${ART47_PERCENTAGE}% de las utilidades`);
      }
      break;
    case "CONVENCIONAL":
      // Lo pactado por contrato es libre, salvo que solo hay calculo por
      // porcentaje de remuneraciones: la participacion en utilidades es el ART47.
      if (data.gratificationMethod !== "PORCENTAJE_REMUNERACIONES") {
        throw new BadRequestError("La gratificacion convencional se define como porcentaje de las remuneraciones");
      }
      break;
  }
}


// Porcentaje del sueldo base que la EMPRESA anticipa cada mes. Un anticipo no
// puede superar lo que la gratificacion da por mes: en ART50 el tope es el 25%;
// en ART47 la gratificacion depende de las utilidades y se paga una vez al
// ano, asi que no hay anticipo mensual que definir; en CONVENCIONAL el
// porcentaje pactado es de cada contrato, asi que solo se acota a 100.
export function assertCompanyAdvancePercentage(system: GratificationType | null, percentage: number | null): void {
  if (percentage === null) return;
  if (system === null) {
    throw new BadRequestError("Defina primero el sistema de gratificacion para indicar el anticipo mensual");
  }
  if (system === "ART47") {
    throw new BadRequestError("La gratificacion del ART47 no lleva anticipo mensual");
  }
  const max = system === "ART50" ? ART50_PERCENTAGE : 100;
  if (percentage <= 0 || percentage > max) {
    throw new BadRequestError(`El anticipo mensual debe ser mayor a 0% y hasta ${max}% del sueldo base`);
  }
}
