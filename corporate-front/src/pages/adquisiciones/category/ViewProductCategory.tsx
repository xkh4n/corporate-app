import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../../components/RequirePermissions";
import { Spinner, Input, EmptyState } from "../../../components/ui";
import { handleError } from "../../../lib/Errors";
import { productCategoryService } from "../../../services";
import type { ProductCategory } from "../../../types";

const REQUIRED_PERMISSIONS = ["product-categories:read"] as const;

export default function ViewProductCategory() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const res = await productCategoryService.list({ limit: 1000, search: search.trim() || undefined });
        if (cancelled) return;
        setCategories(res.items);
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
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          Categorías de Producto
        </h1>

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
          ) : categories.length === 0 ? (
            <EmptyState title="Sin categorías" description="No se encontraron categorías con ese criterio." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Nombre</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Descripción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {categories.map((category) => (
                    <tr key={category.id}>
                      <td className="px-4 py-2 font-medium text-slate-900">{category.name}</td>
                      <td className="px-4 py-2 text-slate-600">{category.description ?? "-"}</td>
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
