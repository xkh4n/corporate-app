import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, EmptyState, Input, Spinner } from "../../components/ui";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { assetValuationService } from "../../services/assetValuationService";
import type { PendingValuationAsset, ValuationItem, ValuationResult } from "../../types/assetValuation";
import { statusLabel } from "../inventario/inventoryLabels";

// Valorización posterior a la toma de inventario (Adquisiciones TI): los activos
// que la toma dio de alta no tienen costo conocido. Aquí se les asigna valor por
// primera vez, lo que además registra su alta en el Kardex. Un valor ya cargado
// no se corrige desde aquí (es un ajuste manual de contabilidad).
// La pantalla se ve con :read (igual que el menu y el GET de la API); guardar valores exige :update.
const REQUIRED_PERMISSIONS = ["asset-valuation:read"] as const;
const PAGE_SIZE = 200;
const TH = "px-4 py-2 text-left font-semibold text-slate-600";

// El gate envuelve a un componente aparte: la carga inicial vive en ValuationContent, asi no se dispara
// una peticion (y un 403 que redirige) antes de comprobar el permiso.
export default function AssetValuation() {
  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <ValuationContent />
    </RequirePermissions>
  );
}

function ValuationContent() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canUpdate = can("asset-valuation:update");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<PendingValuationAsset[]>([]);
  const [total, setTotal] = useState(0);
  // Valor tipeado por activo (texto, se valida al guardar) y error devuelto por el servidor.
  const [values, setValues] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  async function load(query = search): Promise<void> {
    setLoading(true);
    try {
      const res = await assetValuationService.list({
        search: query.trim() || undefined,
        limit: PAGE_SIZE,
        sortBy: "id",
        sortOrder: "asc",
      });
      setAssets(res.items);
      setTotal(res.pagination.totalItems);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(): Promise<void> {
    const items: ValuationItem[] = [];
    for (const asset of assets) {
      const raw = values[asset.id]?.trim();
      if (!raw) continue;
      const value = Number(raw);
      // 0,01 es el mínimo que acepta el servidor (un valor menor redondearía a 0).
      if (!Number.isFinite(value) || value < 0.01) {
        showErrorToast(`El valor de ${asset.tag} debe ser de al menos 0,01`);
        return;
      }
      items.push({ assetId: asset.id, value });
    }
    if (items.length === 0) {
      showErrorToast("Ingresa el valor de al menos un activo");
      return;
    }

    setSaving(true);
    try {
      const results = await assetValuationService.value(items);
      const failed = results.filter((result: ValuationResult) => !result.ok);
      const okCount = results.length - failed.length;
      if (okCount > 0) showSuccessToast(`${okCount} activo(s) valorizado(s)`);
      if (failed.length > 0) showErrorToast(`${failed.length} activo(s) no se pudieron valorizar, revisa el detalle`);

      // Los valorizados salen de la lista; los que fallaron conservan su valor y muestran el motivo.
      setErrors(Object.fromEntries(failed.map((result) => [result.assetId, result.error ?? "Error"])));
      setValues((prev) =>
        Object.fromEntries(failed.map((result) => [result.assetId, prev[result.assetId] ?? ""])),
      );
      await load();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  const enteredCount = Object.values(values).filter((value) => value.trim() !== "").length;

  return (
    <>
      <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          Valorización de Activos
        </h1>

        <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex max-w-md flex-1 gap-2">
              <Input
                placeholder="Buscar por tag o N° de serie..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void load()}
                className="bg-white"
              />
              <Button type="button" variant="secondary" loading={loading} onClick={() => void load()}>
                Buscar
              </Button>
            </div>
            {canUpdate && (
              <Button type="button" variant="success" loading={saving} onClick={() => void handleSave()}>
                Guardar valores ({enteredCount})
              </Button>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : assets.length === 0 ? (
            <EmptyState
              title="Sin activos pendientes"
              description="Todos los activos valorizables ya tienen valor."
            />
          ) : (
            <>
              {total > assets.length && (
                <p className="mb-2 text-sm text-slate-600">
                  Se muestran {assets.length} de {total} activos pendientes. Guarda y se cargarán los siguientes.
                </p>
              )}
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={TH}>Tag</th>
                      <th className={TH}>Producto</th>
                      <th className={TH}>N° de serie</th>
                      <th className={TH}>Estado</th>
                      <th className={TH}>Centro de costo</th>
                      <th className={TH}>Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {assets.map((asset) => (
                      <tr key={asset.id}>
                        <td className="px-4 py-2 font-medium text-slate-900">{asset.tag}</td>
                        <td className="px-4 py-2 text-slate-600">{asset.productName ?? "-"}</td>
                        <td className="px-4 py-2 text-slate-600">{asset.serialNumber ?? "-"}</td>
                        <td className="px-4 py-2 text-slate-600">{statusLabel(asset.status.code)}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {asset.costCenter ? `${asset.costCenter.code} · ${asset.costCenter.name}` : "-"}
                        </td>
                        <td className="px-4 py-2">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            aria-label={`Valor de ${asset.tag}`}
                            disabled={!canUpdate}
                            value={values[asset.id] ?? ""}
                            onChange={(e) => {
                              setValues((prev) => ({ ...prev, [asset.id]: e.target.value }));
                              setErrors((prev) => {
                                const next = { ...prev };
                                delete next[asset.id];
                                return next;
                              });
                            }}
                            className="w-40 bg-zinc-100 focus:bg-indigo-100"
                          />
                          {errors[asset.id] && <p className="mt-1 text-xs text-red-600">{errors[asset.id]}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
