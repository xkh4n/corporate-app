import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type {
  AccountingClass,
  AccountingClassInput,
  AccountingPolicy,
  AccountingRecord,
  AttributableCost,
  Classification,
  DepreciationLine,
  DepreciationMethod,
  DepreciationRun,
  NextClosePreview,
  PendingAccountingAsset,
  ScheduleRow,
} from "../types/assetAccounting";

// Gestion contable de activos (plan 007). "status" de ListParams filtra por
// etapa (coma-separado, ej. "CLASSIFIED,COSTED").
export const assetAccountingService = {
  listPending: (params?: ListParams) =>
    apiFetch<Paginated<PendingAccountingAsset>>(`/asset-accounting/pending${toQuery(params)}`),

  list: (params?: ListParams & { classification?: Classification }) =>
    apiFetch<Paginated<AccountingRecord>>(`/asset-accounting${toQuery(params)}`),

  get: (assetId: number) => apiFetch<AccountingRecord>(`/asset-accounting/${assetId}`),

  classify: (
    assetId: number,
    input: { classification: Classification; classId?: number; belowThresholdConfirmed?: boolean },
  ) => apiFetch<AccountingRecord>(`/asset-accounting/${assetId}/classification`, { method: "POST", body: input }),

  listCosts: (assetId: number) => apiFetch<AttributableCost[]>(`/asset-accounting/${assetId}/costs`),

  addCost: (assetId: number, input: { concept: string; amount: number; documentRef?: string }) =>
    apiFetch<AttributableCost[]>(`/asset-accounting/${assetId}/costs`, { method: "POST", body: input }),

  removeCost: (assetId: number, costId: number) =>
    apiFetch<void>(`/asset-accounting/${assetId}/costs/${costId}`, { method: "DELETE" }),

  confirmCost: (assetId: number) =>
    apiFetch<AccountingRecord>(`/asset-accounting/${assetId}/cost/confirm`, { method: "POST", body: {} }),

  capitalize: (assetId: number, input: { depreciationStartPeriod?: string }) =>
    apiFetch<AccountingRecord>(`/asset-accounting/${assetId}/capitalize`, { method: "POST", body: input }),

  updateDepreciation: (
    assetId: number,
    input: {
      usefulLifeMonths?: number;
      depreciationMethod?: DepreciationMethod;
      residualValue?: number;
      depreciationStartPeriod?: string;
    },
  ) => apiFetch<AccountingRecord>(`/asset-accounting/${assetId}/depreciation`, { method: "PUT", body: input }),

  schedule: (assetId: number) =>
    apiFetch<{ record: AccountingRecord; rows: ScheduleRow[] }>(`/asset-accounting/${assetId}/depreciation/schedule`),

  // Cierres de depreciacion
  listRuns: (params?: ListParams) => apiFetch<Paginated<DepreciationRun>>(`/asset-depreciation-runs${toQuery(params)}`),

  previewNextClose: () => apiFetch<NextClosePreview>("/asset-depreciation-runs/next"),

  getRun: (id: number) => apiFetch<DepreciationRun & { lines: DepreciationLine[] }>(`/asset-depreciation-runs/${id}`),

  closePeriod: (period: string) =>
    apiFetch<DepreciationRun>("/asset-depreciation-runs", { method: "POST", body: { period } }),

  voidRun: (id: number) => apiFetch<DepreciationRun>(`/asset-depreciation-runs/${id}/void`, { method: "POST", body: {} }),

  // Politica contable
  getPolicy: () => apiFetch<AccountingPolicy>("/asset-accounting-policy"),

  updatePolicy: (capitalizationThreshold: number) =>
    apiFetch<AccountingPolicy>("/asset-accounting-policy", { method: "PUT", body: { capitalizationThreshold } }),

  listClasses: (includeInactive = false) =>
    apiFetch<AccountingClass[]>(`/asset-accounting-policy/classes${includeInactive ? "?includeInactive=true" : ""}`),

  createClass: (input: AccountingClassInput) =>
    apiFetch<AccountingClass>("/asset-accounting-policy/classes", { method: "POST", body: input }),

  updateClass: (id: number, input: Partial<Omit<AccountingClassInput, "code">>) =>
    apiFetch<AccountingClass>(`/asset-accounting-policy/classes/${id}`, { method: "PUT", body: input }),
};
