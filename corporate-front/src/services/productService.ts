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

  // El producto tiene que existir antes (necesita su _id para el nombre de
  // archivo en el backend, ver attachProductImage) -mismo patron de "crear
  // recurso, despues adjuntar" que quoteService/authorizationService.
  uploadImage: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<{ filename: string }>(`/products/${id}/image`, { method: "POST", body: form });
  },

  // GET /products/:id/image exige sesion (authenticate), pero NO pasa por
  // apiFetch: es la URL que va directo en un <img src>, y el navegador ya
  // manda la cookie httpOnly sola en un request same-origin -no hace falta
  // Authorization/fetch manual para esto.
  imageUrl: (id: string) => `/api/products/${id}/image`,
};
