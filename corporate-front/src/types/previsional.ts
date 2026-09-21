// Espejo de corporate-api/src/models/mssql/previsionalInstitution.model.ts.
export type PrevisionalInstitutionType = "AFP" | "SALUD" | "CCAF" | "MUTUAL" | "CESANTIA";

export interface PrevisionalInstitution {
  id: number;
  type: PrevisionalInstitutionType;
  code: string;
  name: string;
  nationalId: string | null;
  // Codigo de las Tablas de Equivalencia de Previred, con cero a la izquierda ("07").
  previredCode: string | null;
  address: string | null;
  phone: string | null;
  legalRepresentative: string | null;
  isActive: boolean;
}

// Tabla 4 y Tabla 5 de Previred.
export type PrevisionalRegime = "AFP" | "INP" | "SIP";
export type PrevisionalWorkerType = 0 | 1 | 2 | 3 | 8 | 9;
// Tabla 17: 1 pesos, 2 UF.
export type HealthPlanCurrency = 1 | 2;

// Espejo de corporate-api/src/models/mssql/employeePrevisionalProfile.model.ts
// (solo lo que estas pantallas leen). regime/workerType son null hasta que se
// asigna la AFP: el perfil nace con la primera pieza asignada, sea cual sea.
export interface EmployeePrevisionalProfile {
  id: number;
  employeeId: number;
  regime: PrevisionalRegime | null;
  workerType: PrevisionalWorkerType | null;
  afpInstitutionId: number | null;
  healthInstitutionId: number | null;
  healthFun: string | null;
  healthPlanCurrency: HealthPlanCurrency | null;
  healthAgreedAmount: number | null;
  afp?: PrevisionalInstitution | null;
  healthInstitution?: PrevisionalInstitution | null;
}

// CCAF y mutual son de la EMPRESA: el colaborador las hereda, no se guardan
// por trabajador.
export interface EmployerInheritance {
  ccaf: PrevisionalInstitution | null;
  mutual: PrevisionalInstitution | null;
  mutualBranchCode: number | null;
  workAccidentRate: number | null;
}

export interface PrevisionalProfileView {
  employeeId: number;
  profile: EmployeePrevisionalProfile | null;
  employer: EmployerInheritance;
}

export interface PensionAssignInput {
  regime: PrevisionalRegime;
  workerType: PrevisionalWorkerType;
  afpInstitutionId: number | null;
}

export interface HealthAssignInput {
  healthInstitutionId: number;
  healthFun: string | null;
  healthPlanCurrency: HealthPlanCurrency | null;
  healthAgreedAmount: number | null;
}

// Fila unica de configuracion de la empresa (previred_employer_settings).
export interface PreviredEmployerSettings {
  id: number;
  ccafInstitutionId: number | null;
  mutualInstitutionId: number | null;
  mutualBranchCode: number | null;
  workAccidentRate: number | null;
  ccaf?: PrevisionalInstitution | null;
  mutual?: PrevisionalInstitution | null;
}

export interface PreviredEmployerSettingsInput {
  ccafInstitutionId: number | null;
  mutualInstitutionId: number | null;
  mutualBranchCode: number | null;
  workAccidentRate: number | null;
}
