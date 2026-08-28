import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { GoodsReceipt, GoodsReceiptCreateInput } from "../types/goodsReceipt";

export const goodsReceiptService = {
  // purchaseOrderId es obligatorio (400 si no viene).
  list: (purchaseOrderId: number, params?: ListParams) =>
    apiFetch<Paginated<GoodsReceipt>>(`/goods-receipts${toQuery({ purchaseOrderId, ...params })}`),

  getById: (id: number) => apiFetch<GoodsReceipt>(`/goods-receipts/${id}`),

  // Confirmar una recepcion crea ademas un Asset del lado del servidor (efecto colateral, sin accion en el cliente).
  create: (input: GoodsReceiptCreateInput) =>
    apiFetch<GoodsReceipt>("/goods-receipts", { method: "POST", body: input }),

  // Adjunto multipart: mismas restricciones de tipo/tamano que quotes.
  uploadAttachment: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<{ filename: string }>(`/goods-receipts/${id}/attachment`, { method: "POST", body: form });
  },
};
