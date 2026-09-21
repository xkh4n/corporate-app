// Espejo de corporate-api/src/models/mssql/payrollSettings.model.ts y
// employeeContract.model.ts.

// ART47: participacion en utilidades (30%). ART50: 25% de las remuneraciones
// mensuales con tope de 4,75 IMM. CONVENCIONAL: la pactada en el contrato.
export type GratificationType = "ART47" | "ART50" | "CONVENCIONAL";
export type GratificationMethod = "PORCENTAJE_REMUNERACIONES" | "PARTICIPACION_UTILIDADES";
export type GratificationCapType = "IMM";
// MENSUAL: se paga cada mes. ANTICIPO_MENSUAL_RELIQUIDACION: anticipos mensuales
// y una reliquidacion en un mes pactado. ANUAL: un solo pago en ese mes.
export type GratificationPaymentMode = "MENSUAL" | "ANTICIPO_MENSUAL_RELIQUIDACION" | "ANUAL";
export type EmployeeContractType = "INDEFINIDO" | "PLAZO_FIJO";

export interface PayrollSettings {
  id: number;
  // null = la empresa todavia no define su sistema de gratificacion.
  gratificationSystem: GratificationType | null;
  // % del sueldo base que se anticipa cada mes; null = la empresa no define uno.
  gratificationMonthlyAdvancePercentage: number | null;
}

export interface PayrollSettingsInput {
  gratificationSystem: GratificationType | null;
  gratificationMonthlyAdvancePercentage: number | null;
}

export type PayrollParameterCode = "IMM";

export interface PayrollParameter {
  id: number;
  code: PayrollParameterCode;
  // Pesos para IMM.
  value: number;
  validFrom: string;
  // null = vigente hasta nuevo aviso.
  validTo: string | null;
}

export interface PayrollParameterInput {
  code: PayrollParameterCode;
  value: number;
  validFrom: string;
}

export interface EmployeeContract {
  id: number;
  employeeId: number;
  contractType: EmployeeContractType;
  startDate: string;
  endDate: string | null;
  baseSalary: number;
  gratificationType: GratificationType;
  gratificationMethod: GratificationMethod;
  gratificationPercentage: number;
  gratificationCapType: GratificationCapType | null;
  gratificationCapFactor: number | null;
  gratificationPaymentMode: GratificationPaymentMode;
  gratificationSettlementMonth: number | null;
  // Pesos que se anticipan cada mes; solo con ANTICIPO_MENSUAL_RELIQUIDACION.
  gratificationMonthlyAdvance: number | null;
  gratificationAdjustAdvancesCpi: boolean;
}

export type EmployeeContractCreateInput = Omit<EmployeeContract, "id">;
