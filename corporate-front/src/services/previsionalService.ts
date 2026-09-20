import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type {
  HealthAssignInput,
  PensionAssignInput,
  PrevisionalInstitution,
  PrevisionalInstitutionType,
  PrevisionalProfileView,
  PreviredEmployerSettings,
  PreviredEmployerSettingsInput,
} from "../types/previsional";

export const previsionalService = {
  // AFC no se ofrece: nada se le asigna a un colaborador ni a la empresa.
  listInstitutions: (type: Exclude<PrevisionalInstitutionType, "CESANTIA">, params?: ListParams) =>
    apiFetch<Paginated<PrevisionalInstitution>>(`/previsional-institutions${toQuery({ ...params, type })}`),

  // profile es null mientras al colaborador no se le asigne nada.
  getProfile: (employeeId: number) => apiFetch<PrevisionalProfileView>(`/previsional-profiles/${employeeId}`),

  assignPension: (employeeId: number, body: PensionAssignInput) =>
    apiFetch<PrevisionalProfileView>(`/previsional-profiles/${employeeId}/pension`, { method: "PUT", body }),

  assignHealth: (employeeId: number, body: HealthAssignInput) =>
    apiFetch<PrevisionalProfileView>(`/previsional-profiles/${employeeId}/health`, { method: "PUT", body }),

  // null = la empresa todavia no definio su CCAF/mutual.
  getEmployerSettings: () => apiFetch<PreviredEmployerSettings | null>("/previred-settings"),

  saveEmployerSettings: (body: PreviredEmployerSettingsInput) =>
    apiFetch<PreviredEmployerSettings | null>("/previred-settings", { method: "PUT", body }),
};
