import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type {
  SupplierProduct,
  SupplierProductCreateInput,
  SupplierProductWithProduct,
  SupplierProductWithSupplier,
} from "../types/supplierProduct";

export const supplierProductService = {
  // Productos vinculados a un proveedor (con el producto embebido) -pantalla
  // de administracion del vinculo.
  listBySupplier: (supplierId: number, params?: ListParams) =>
    apiFetch<Paginated<SupplierProductWithProduct>>(`/supplier-products${toQuery({ supplierId, ...params })}`),

  // Direccion inversa: proveedores vinculados a un producto (con el proveedor
  // embebido) -usada para restringir el selector de proveedor al cargar una
  // cotizacion (ver UploadQuotes.tsx) a los que realmente lo venden.
  listByProduct: (productId: string, params?: ListParams) =>
    apiFetch<Paginated<SupplierProductWithSupplier>>(`/supplier-products${toQuery({ productId, ...params })}`),

  create: (input: SupplierProductCreateInput) =>
    apiFetch<SupplierProduct>("/supplier-products", { method: "POST", body: input }),

  remove: (id: number) => apiFetch<void>(`/supplier-products/${id}`, { method: "DELETE" }),
};
