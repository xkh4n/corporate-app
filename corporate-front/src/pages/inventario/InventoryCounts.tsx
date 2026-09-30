import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, EmptyState, Spinner } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { inventoryCountService } from "../../services";
import type { InventoryCount, InventoryCountDetail } from "../../types/inventoryCount";
import { InventoryCapture } from "./InventoryCapture";
import { InventoryReport } from "./InventoryReport";
import { formatDateTime } from "./inventoryLabels";

// Toma de inventario fisica (levantamiento por un auditor). Ver
// .claude/planes/002-toma-inventario-activos.html. El enrutado del front lo
// dicta GET /auth/menu (una ruta fuera del menu cae en ForbiddenPage), asi que
// las 3 vistas viven en UNA sola ruta y se distinguen por ?count=<id>:
// listado (sin count), captura (toma abierta) y reporte (toma cerrada).
const REQUIRED_PERMISSIONS = ["inventory-counts:read"] as const;

const TH = "whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600";

export default function InventoryCounts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawCount = Number(searchParams.get("count"));
  const countId = Number.isInteger(rawCount) && rawCount > 0 ? rawCount : null;

  function openCount(id: number): void {
    setSearchParams({ count: String(id) });
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Toma de Inventario</h1>

        <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8">
          {countId === null ? (
            <CountList onOpen={openCount} />
          ) : (
            <CountDetail id={countId} onBack={() => setSearchParams({})} />
          )}
        </div>
      </div>
    </RequirePermissions>
  );
}

// Listado de tomas + "Inicio de Inventario".
function CountList({ onOpen }: { onOpen: (id: number) => void }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await inventoryCountService.list({ limit: 100, sortBy: "id", sortOrder: "desc" });
        if (!cancelled) setCounts(res.items);
      } catch (error) {
        if (!cancelled) handleError(error, navigate);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleStart(): Promise<void> {
    setStarting(true);
    try {
      const started = await inventoryCountService.start();
      showSuccessToast(
        started.resumed ? `Se retoma la toma abierta ${started.number}` : `Toma ${started.number} iniciada`,
      );
      onOpen(started.id);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div>
      {can("inventory-counts:create") && (
        <div className="mb-4">
          <Button type="button" className="w-full py-3 sm:w-auto sm:py-2" loading={starting} onClick={() => void handleStart()}>
            Inicio de Inventario
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : counts.length === 0 ? (
        <EmptyState title="Sin tomas" description="Aún no se ha realizado ninguna toma de inventario." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Folio</th>
                <th className={TH}>Nombre</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Inicio</th>
                <th className={TH}>Fin</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {counts.map((count) => (
                <tr key={count.id}>
                  <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">{count.number}</td>
                  <td className="min-w-[10rem] px-4 py-2 text-slate-600">{count.name}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                        count.status === "OPEN" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {count.status === "OPEN" ? "Abierta" : "Cerrada"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">{formatDateTime(count.startedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">{formatDateTime(count.closedAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <Button type="button" variant="secondary" className="whitespace-nowrap" onClick={() => onOpen(count.id)}>
                      {count.status === "OPEN" ? "Abrir" : "Ver informe"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Una toma puntual: abierta -> captura, cerrada -> reporte.
function CountDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const navigate = useNavigate();
  const [count, setCount] = useState<InventoryCountDetail | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(): Promise<void> {
    try {
      setCount(await inventoryCountService.getById(id));
    } catch (error) {
      setCount(null);
      handleError(error, navigate);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div>
      <div className="mb-4">
        <Button type="button" variant="secondary" onClick={onBack}>
          ← Volver al listado
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : !count ? (
        <EmptyState title="Toma no encontrada" description="La toma de inventario no existe o no se pudo cargar." />
      ) : count.status === "OPEN" ? (
        <InventoryCapture count={count} onClosed={() => void load()} />
      ) : (
        <InventoryReport count={count} />
      )}
    </div>
  );
}
