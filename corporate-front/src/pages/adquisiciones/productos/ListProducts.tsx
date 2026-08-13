import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../../components/RequirePermissions";
import { Spinner, Input, EmptyState, ImagePreviewThumbnail } from "../../../components/ui";
import { handleError } from "../../../lib/Errors";
import { productCategoryService, productService } from "../../../services";
import type { Product, ProductCategory } from "../../../types";

const REQUIRED_PERMISSIONS = ["products:read"] as const;

const PRODUCT_TYPE_LABEL: Record<Product["productType"], string> = {
  ARRIENDO: "Arriendo",
  COMPRA: "Compra",
  SERVICIO: "Servicio",
};

export default function ListProducts() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Record<string, ProductCategory>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [productsRes, categoriesRes] = await Promise.all([
          productService.list({ limit: 100, search: search.trim() || undefined }),
          productCategoryService.list({ limit: 1000 }),
        ]);
        if (cancelled) return;
        setProducts(productsRes.items);
        setCategories(Object.fromEntries(categoriesRes.items.map((cat) => [cat.id, cat])));
      } catch (error) {
        handleError(error, navigate);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, search]);

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Productos</h1>

        <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-4 max-w-sm">
            <Input
              placeholder="Buscar por nombre o descripcion..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-white"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : products.length === 0 ? (
            <EmptyState title="Sin productos" description="No se encontraron productos con ese criterio." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Imagen</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Nombre</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Categoria</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Tipo</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Descripcion</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td className="px-4 py-2">
                        {product.image ? (
                          <ImagePreviewThumbnail
                            src={productService.imageUrl(product.id)}
                            alt={product.name}
                            className="h-12 w-12 rounded-md object-cover border border-slate-200"
                          />
                        ) : (
                          <div className="h-12 w-12 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] text-slate-400">
                            Sin foto
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-900">{product.name}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {product.categoryId ? (categories[product.categoryId]?.name ?? "-") : "-"}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{PRODUCT_TYPE_LABEL[product.productType]}</td>
                      <td className="px-4 py-2 text-slate-600">{product.description ?? "-"}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            product.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                          }`}
                        >
                          {product.isActive ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </RequirePermissions>
  );
}
