import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { AssetKardexEntry, CreateManualKardexEntryInput, ProductKardexBalance } from "../types/assetKardex";

export const assetKardexService = {
  // Sin getById: solo existe listado (filtrado por assetId, obligatorio -400 si falta) y creacion manual.
  listByAsset: (assetId: number, params?: ListParams) =>
    apiFetch<Paginated<AssetKardexEntry>>(`/asset-kardex${toQuery({ assetId, ...params })}`),
  listByProduct: () => apiFetch<ProductKardexBalance[]>("/asset-kardex/by-product"),
  createManualEntry: (body: CreateManualKardexEntryInput) =>
    apiFetch<AssetKardexEntry>("/asset-kardex", { method: "POST", body }),
};
