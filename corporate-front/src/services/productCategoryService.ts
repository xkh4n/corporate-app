import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { ProductCategory, ProductCategoryCreateInput, ProductCategoryUpdateInput } from "../types/productCategory";

// id es ObjectId de Mongo (string), no number como en el resto de services.
// No hay endpoint de baja para categorias.
export const productCategoryService = {
  list: (params?: ListParams) => apiFetch<Paginated<ProductCategory>>(`/product-categories${toQuery(params)}`),
  getById: (id: string) => apiFetch<ProductCategory>(`/product-categories/${id}`),
  create: (body: ProductCategoryCreateInput) =>
    apiFetch<ProductCategory>("/product-categories", { method: "POST", body }),
  update: (id: string, body: ProductCategoryUpdateInput) =>
    apiFetch<ProductCategory>(`/product-categories/${id}`, { method: "PUT", body }),
};
