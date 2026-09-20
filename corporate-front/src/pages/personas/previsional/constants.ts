import type { PrevisionalRegime, PrevisionalWorkerType } from "../../../types";

// Tabla 4 de Previred.
export const REGIME_OPTIONS: { value: PrevisionalRegime; label: string }[] = [
  { value: "AFP", label: "AFP" },
  { value: "INP", label: "IPS (ex INP)" },
  { value: "SIP", label: "Sin institución previsional" },
];

// Tabla 5 de Previred.
export const WORKER_TYPE_OPTIONS: { value: PrevisionalWorkerType; label: string }[] = [
  { value: 0, label: "Activo (no pensionado)" },
  { value: 1, label: "Pensionado y cotiza" },
  { value: 2, label: "Pensionado y no cotiza / invalidez total" },
  { value: 3, label: "Activo desde los 65 años (nunca pensionado)" },
  { value: 8, label: "Exento de cotizar" },
  { value: 9, label: "Pensionado por invalidez parcial" },
];

// Codigo Previred de FONASA dentro de las instituciones de salud (Tabla 16).
export const FONASA_PREVIRED_CODE = "07";
// Codigo Previred del ISL dentro de las mutualidades (Tabla 19).
export const ISL_PREVIRED_CODE = "00";

// Tabla 17.
export const HEALTH_CURRENCY_OPTIONS = [
  { value: 1, label: "Pesos ($)" },
  { value: 2, label: "UF" },
] as const;
