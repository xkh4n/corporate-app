import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Product, ProductCreateInput, ProductUpdateInput } from "../types/product";

// id es ObjectId de Mongo (string), no number como en el resto de services.
export const productService = {
  list: (params?: ListParams) => apiFetch<Paginated<Product>>(`/products${toQuery(params)}`),
  getById: (id: string) => apiFetch<Product>(`/products/${id}`),
  create: (body: ProductCreateInput) => apiFetch<Product>("/products", { method: "POST", body }),
  update: (id: string, body: ProductUpdateInput) => apiFetch<Product>(`/products/${id}`, { method: "PUT", body }),
  deactivate: (id: string) => apiFetch<void>(`/products/${id}`, { method: "DELETE" }),
};
