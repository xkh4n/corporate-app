import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState, Input, Spinner } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { assetReturnService } from "../../services/assetReturnService";
import type { AssetReturnCandidate, AssetReturnScope } from "../../types/assetReturn";
import { statusLabel } from "../inventario/inventoryLabels";

const PAGE_SIZE = 100;
const TH = "whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600";

// Selector de activos devolvibles (asignados y sin otra devolucion vigente). Lo usan "Nueva devolucion" y
// "Agregar activos" de un borrador. Una devolucion admite hasta 100 activos (limite del servidor).
//  - scope OTHERS: los de otro usuario en el centro de costo elegido (costCenterId obligatorio).
//  - scope OWN ("mis equipos"): los asignados a quien consulta, de cualquier centro de costo. El centro de costo
//    de la devolucion es el del activo y no se elige: como una devolucion es de UN solo centro, al marcar un equipo
//    quedan deshabilitados los de otros centros (o todos los de otro centro si costCenterId ya viene fijado).
export function CandidatePicker({
  scope,
  costCenterId,
  confirmLabel,
  busy = false,
  onConfirm,
}: {
  scope: AssetReturnScope;
  costCenterId?: number;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (assetIds: number[]) => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AssetReturnCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Descarta la respuesta de una busqueda vieja si ya se lanzo otra.
  const requestRef = useRef(0);

  const load = useCallback(
    async (query: string): Promise<void> => {
      const request = ++requestRef.current;
      setLoading(true);
      try {
        const res = await assetReturnService.candidates({ scope, costCenterId }, {
          search: query.trim() || undefined,
          limit: PAGE_SIZE,
          sortBy: "tag",
          sortOrder: "asc",
        });
        if (request !== requestRef.current) return;
        setItems(res.items);
        setTotal(res.pagination.totalItems);
        // Lo seleccionado que ya no aparece en la lista (otra busqueda) se descarta.
        setSelected((prev) => new Set([...prev].filter((id) => res.items.some((item) => item.assetId === id))));
      } catch (error) {
        if (request === requestRef.current) handleError(error, navigate);
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [scope, costCenterId, navigate],
  );

  useEffect(() => {
    setSearch("");
    setSelected(new Set());
    void load("");
  }, [load]);

  function toggle(assetId: number): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  // En "mis equipos" el centro de costo lo fija el primer equipo marcado.
  const lockedCostCenterId =
    scope === "OWN" ? (items.find((item) => selected.has(item.assetId))?.costCenter?.id ?? null) : null;
  const isSelectable = (item: AssetReturnCandidate): boolean =>
    lockedCostCenterId === null || item.costCenter?.id === lockedCostCenterId;
  const selectableItems = items.filter(isSelectable);
  const allSelected = selectableItems.length > 0 && selectableItems.every((item) => selected.has(item.assetId));

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex w-full max-w-md gap-2 sm:flex-1">
          <Input
            placeholder="Buscar por tag o N° de serie..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load(search)}
            className="bg-white"
          />
          <Button type="button" variant="secondary" loading={loading} onClick={() => void load(search)}>
            Buscar
          </Button>
        </div>
        <Button
          type="button"
          className="w-full sm:w-auto"
          loading={busy}
          disabled={selected.size === 0}
          onClick={() => void onConfirm([...selected])}
        >
          {confirmLabel} ({selected.size})
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Sin activos para devolver"
          description={
            scope === "OWN"
              ? "No tiene equipos asignados disponibles para devolver, o ya están en otra devolución."
              : "No hay activos asignados a otros usuarios en este centro de costo, o ya están en otra devolución."
          }
        />
      ) : (
        <>
          {total > items.length && (
            <p className="mb-2 text-sm text-slate-600">
              Se muestran {items.length} de {total} activos. Use la búsqueda para acotar.
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      aria-label="Seleccionar todos"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(selectableItems.map((item) => item.assetId)))
                      }
                    />
                  </th>
                  <th className={TH}>Tag</th>
                  <th className={TH}>Producto</th>
                  <th className={TH}>N° de serie</th>
                  <th className={TH}>Estado</th>
                  <th className={TH}>Usuario</th>
                  {scope === "OWN" && <th className={TH}>Centro de costo</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.assetId} className={selected.has(item.assetId) ? "bg-brand-50" : undefined}>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        aria-label={`Seleccionar ${item.tag}`}
                        checked={selected.has(item.assetId)}
                        disabled={!isSelectable(item)}
                        title={isSelectable(item) ? undefined : "Es de otro centro de costo: haga una devolución por centro"}
                        onChange={() => toggle(item.assetId)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">{item.tag}</td>
                    <td className="min-w-[10rem] px-4 py-2 text-slate-600">{item.productName ?? "-"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">{item.serialNumber ?? "-"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">{statusLabel(item.statusCode)}</td>
                    <td className="min-w-[10rem] px-4 py-2 text-slate-600">{item.holder?.fullName ?? "-"}</td>
                    {scope === "OWN" && (
                      <td className="min-w-[10rem] px-4 py-2 text-slate-600">
                        {item.costCenter ? `${item.costCenter.code} · ${item.costCenter.name}` : "-"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
