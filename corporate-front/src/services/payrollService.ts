import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type {
  PayrollParameter,
  PayrollParameterCode,
  PayrollParameterInput,
  PayrollSettings,
  PayrollSettingsInput,
} from "../types/payroll";

export const payrollService = {
  // null = la empresa todavia no configuro su sistema de gratificacion.
  getSettings: () => apiFetch<PayrollSettings | null>("/payroll-settings"),

  saveSettings: (body: PayrollSettingsInput) =>
    apiFetch<PayrollSettings | null>("/payroll-settings", { method: "PUT", body }),

  // Historial de vigencias, la vigente primero.
  listParameters: (code: PayrollParameterCode) =>
    apiFetch<PayrollParameter[]>(`/payroll-parameters${toQuery({ code })}`),

  setParameter: (body: PayrollParameterInput) =>
    apiFetch<PayrollParameter[]>("/payroll-parameters", { method: "PUT", body }),
};
