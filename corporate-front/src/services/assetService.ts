import { apiFetch, apiFetchBlob } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Asset, AssetLabelConfig, AssetUpdateInput } from "../types/asset";

export const assetService = {
  // Sin create: los assets se crean server-side al confirmar un GoodsReceipt, no via este recurso.
  // goodsReceiptId opcional: assets nacidos de UNA recepcion puntual (ReceiveGoods.tsx, Fase D).
  // requestId opcional: TODOS los assets de una solicitud, sin paginar (AssignAssets.tsx, Fase E).
  list: (params?: ListParams & { goodsReceiptId?: number; requestId?: number }) =>
    apiFetch<Paginated<Asset>>(`/assets${toQuery(params)}`),
  getById: (id: number) => apiFetch<Asset>(`/assets/${id}`),
  update: (id: number, body: AssetUpdateInput) => apiFetch<Asset>(`/assets/${id}`, { method: "PUT", body }),

  // ZPL en texto plano, no el sobre {codigo,message,data} -mismo criterio que
  // downloadHandover en assetMovementService.ts. La impresion REAL la hace
  // el navegador (WebUSB), este backend solo genera el texto.
  downloadLabel: async (id: number, config?: Partial<AssetLabelConfig>): Promise<string> => {
    const blob = await apiFetchBlob(`/assets/${id}/label.zpl${toQuery(config)}`);
    return blob.text();
  },
  downloadLabelsBatch: async (assetIds: number[], config?: Partial<AssetLabelConfig>): Promise<string> => {
    const blob = await apiFetchBlob(`/assets/labels.zpl`, { method: "POST", body: { assetIds, config } });
    return blob.text();
  },
};
