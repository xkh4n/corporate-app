import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { SupplierProduct, SupplierProductCreateInput } from "../types/supplierProduct";

export const supplierProductService = {
  // El backend exige exactamente uno de supplierId/productId como filtro (400 si no viene ninguno).
  list: (filter: { supplierId: number } | { productId: string }, params?: ListParams) =>
    apiFetch<Paginated<SupplierProduct>>(`/supplier-products${toQuery({ ...filter, ...params })}`),

  create: (input: SupplierProductCreateInput) =>
    apiFetch<SupplierProduct>("/supplier-products", { method: "POST", body: input }),

  remove: (id: number) => apiFetch<void>(`/supplier-products/${id}`, { method: "DELETE" }),
};
