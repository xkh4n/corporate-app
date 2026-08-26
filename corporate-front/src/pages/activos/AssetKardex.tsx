import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Input, Button, EmptyState } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { assetKardexService, assetService, productService } from "../../services";
import type { Asset } from "../../types/asset";
import type { AssetKardexEntry, ProductKardexBalance } from "../../types/assetKardex";

// Kardex de valorizacion contable (admin-only, ver asset-kardex:read en el
// catalogo de permisos -es data contable, mismo criterio que la separacion
// de funciones "adquisiciones" vs "contabilidad" que ya se planteo para el
// RBAC granular). Dos vistas: por activo (ledger completo, insert-only) y
// por producto (valorizacion agregada derivada del mismo ledger).
const REQUIRED_PERMISSIONS = ["asset-kardex:read", "assets:read", "products:read"] as const;

const ENTRY_TYPE_LABEL: Record<AssetKardexEntry["entryType"], string> = {
  ACQUISITION: "Alta (recepción)",
  ADJUSTMENT: "Ajuste",
  WRITE_OFF: "Baja",
};

function formatMoney(value: string): string {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(Number(value));
}

export default function AssetKardex() {
  const navigate = useNavigate();
  const [view, setView] = useState<"asset" | "product">("asset");

  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [entries, setEntries] = useState<AssetKardexEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const [productBalances, setProductBalances] = useState<(ProductKardexBalance & { productName: string })[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  async function handleSearch(): Promise<void> {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const res = await assetService.list({ search: search.trim(), limit: 20 });
      setResults(res.items);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSearching(false);
    }
  }

  async function handleSelectAsset(asset: Asset): Promise<void> {
    setSelectedAsset(asset);
    setLoadingEntries(true);
    try {
      const res = await assetKardexService.listByAsset(asset.id, { sortBy: "id", sortOrder: "desc", limit: 1000 });
      setEntries(res.items);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setLoadingEntries(false);
    }
  }

  async function loadProductBalances(): Promise<void> {
    setLoadingProducts(true);
    try {
      const balances = await assetKardexService.listByProduct();
      const withNames = await Promise.all(
        balances.map(async (balance) => {
          try {
            const product = await productService.getById(balance.productId);
            return { ...balance, productName: product.name };
          } catch {
            // products:read puede fallar para un rol sin ese permiso, o el
            // producto pudo haberse borrado -se muestra el id crudo en vez
            // de tumbar toda la vista agregada.
            return { ...balance, productName: balance.productId };
          }
        }),
      );
      setProductBalances(withNames);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setLoadingProducts(false);
    }
  }

  useEffect(() => {
    if (view === "product" && productBalances.length === 0) {
      void loadProductBalances();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Kardex de Activos</h1>

        <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-4 flex gap-2">
            <Button type="button" variant={view === "asset" ? "primary" : "secondary"} onClick={() => setView("asset")}>
              Por activo
            </Button>
            <Button
              type="button"
              variant={view === "product" ? "primary" : "secondary"}
              onClick={() => setView("product")}
            >
              Por producto
            </Button>
          </div>

          {view === "asset" ? (
            <>
              <div className="mb-4 flex max-w-md gap-2">
                <Input
                  placeholder="Buscar por tag o N° de serie..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
                  className="bg-white"
                />
                <Button type="button" variant="secondary" loading={searching} onClick={() => void handleSearch()}>
                  Buscar
                </Button>
              </div>

              {results.length > 0 && !selectedAsset && (
                <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Tag</th>
                        <th className="px-4 py-2 text-left font-semibold text-slate-600">N° de serie</th>
                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Estado</th>
                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {results.map((asset) => (
                        <tr key={asset.id}>
                          <td className="px-4 py-2 font-medium text-slate-900">{asset.tag}</td>
                          <td className="px-4 py-2 text-slate-600">{asset.serialNumber ?? "-"}</td>
                          <td className="px-4 py-2 text-slate-600">{asset.status.name}</td>
                          <td className="px-4 py-2">
                            <Button type="button" variant="secondary" onClick={() => void handleSelectAsset(asset)}>
                              Ver kardex
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedAsset && (
                <div>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-4">
                    <h2 className="font-semibold text-slate-800">
                      {selectedAsset.tag}
                      {selectedAsset.serialNumber && (
                        <span className="text-slate-500 font-normal"> — N/S {selectedAsset.serialNumber}</span>
                      )}
                    </h2>
                    <Button type="button" variant="secondary" onClick={() => setSelectedAsset(null)}>
                      Volver a buscar
                    </Button>
                  </div>

                  {loadingEntries ? (
                    <div className="flex justify-center py-12">
                      <Spinner />
                    </div>
                  ) : entries.length === 0 ? (
                    <EmptyState title="Sin movimientos" description="Este activo todavía no tiene asientos en el kardex." />
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-slate-600">Fecha</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-600">Tipo</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-600">Costo unitario</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-600">Monto</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-600">Saldo</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-600">Referencia</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {entries.map((entry) => (
                            <tr key={entry.id}>
                              <td className="px-3 py-2 text-slate-600">
                                {new Date(entry.entryDate).toLocaleDateString("es-CL")}
                              </td>
                              <td className="px-3 py-2 text-slate-600">{ENTRY_TYPE_LABEL[entry.entryType]}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{formatMoney(entry.unitCost)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{formatMoney(entry.amount)}</td>
                              <td className="px-3 py-2 text-right font-medium text-slate-900">
                                {formatMoney(entry.balance)}
                              </td>
                              <td className="px-3 py-2 text-slate-600">{entry.reference ?? "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : loadingProducts ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : productBalances.length === 0 ? (
            <EmptyState title="Sin valorización" description="Todavía no hay activos con producto asociado en el kardex." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Producto</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-600">Asientos</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-600">Valorización</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {productBalances.map((balance) => (
                    <tr key={balance.productId}>
                      <td className="px-4 py-2 font-medium text-slate-900">{balance.productName}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{balance.entryCount}</td>
                      <td className="px-4 py-2 text-right font-medium text-slate-900">{formatMoney(balance.balance)}</td>
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
