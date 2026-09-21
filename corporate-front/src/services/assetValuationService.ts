import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { PendingValuationAsset, ValuationItem, ValuationResult } from "../types/assetValuation";

export const assetValuationService = {
  // Activos con value NULL (excluye baja y devaluados). Exige asset-valuation:read.
  list: (params?: ListParams) => apiFetch<Paginated<PendingValuationAsset>>(`/asset-valuation${toQuery(params)}`),

  // Lote de hasta 200 activos; responde el resultado por activo. Exige asset-valuation:update.
  value: (items: ValuationItem[]) =>
    apiFetch<ValuationResult[]>("/asset-valuation", { method: "POST", body: { items } }),
};
