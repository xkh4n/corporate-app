import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, EmptyState, Field, Input, Select, Spinner, Textarea } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { assetReturnService } from "../../services/assetReturnService";
import { costCenterService } from "../../services";
import type { AssetReturnScope, AssetReturnStatus, AssetReturnSummary } from "../../types/assetReturn";
import type { CostCenter } from "../../types/costCenter";
import { formatDateTime } from "../inventario/inventoryLabels";
import { AssetReturnDetailView } from "./AssetReturnDetail";
import { CandidatePicker } from "./CandidatePicker";
import {
  RETURN_SCOPE_LABELS,
  RETURN_STATUS_CLASSES,
  RETURN_STATUS_LABELS,
  RETURN_STATUS_OPTIONS,
} from "./assetReturnLabels";

// Devolucion de activos a Adquisiciones TI con guia de despacho. Ver
// .claude/planes/004-devolucion-de-activos.html. El enrutado del front lo dicta
// GET /auth/menu (una ruta fuera del menu cae en ForbiddenPage), asi que las
// vistas viven en UNA sola ruta y se distinguen por ?return=<id>: listado (sin
// return) y detalle de una devolucion (borrador, enviada o recibida).
const REQUIRED_PERMISSIONS = ["asset-returns:read"] as const;

const TH = "px-4 py-2 text-left font-semibold text-slate-600";

export default function AssetReturns() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawReturn = Number(searchParams.get("return"));
  const returnId = Number.isInteger(rawReturn) && rawReturn > 0 ? rawReturn : null;

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          Devoluciones de Activos
        </h1>

        <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
          {returnId === null ? (
            <ReturnList onOpen={(id) => setSearchParams({ return: String(id) })} />
          ) : (
            <AssetReturnDetailView id={returnId} onBack={() => setSearchParams({})} />
          )}
        </div>
      </div>
    </RequirePermissions>
  );
}

// Listado + "Nueva devolucion".
function ReturnList({ onOpen }: { onOpen: (id: number) => void }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [returns, setReturns] = useState<AssetReturnSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<AssetReturnStatus | "">("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  async function load(status: AssetReturnStatus | "" = statusFilter, query: string = search): Promise<void> {
    setLoading(true);
    try {
      const res = await assetReturnService.list({
        limit: 100,
        sortBy: "id",
        sortOrder: "desc",
        status: status || undefined,
        search: query.trim() || undefined,
      });
      setReturns(res.items);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (creating) {
    return <NewReturn onCancel={() => setCreating(false)} onCreated={onOpen} />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {can("asset-returns:create") && (
          <Button type="button" onClick={() => setCreating(true)}>
            Nueva devolución
          </Button>
        )}
        <div className="flex max-w-md flex-1 gap-2">
          <Input
            placeholder="Buscar por código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load()}
            className="bg-white"
          />
          <Select
            aria-label="Estado"
            value={statusFilter}
            onChange={(e) => {
              const value = e.target.value as AssetReturnStatus | "";
              setStatusFilter(value);
              void load(value);
            }}
            className="w-44 bg-white"
          >
            <option value="">Todos los estados</option>
            {RETURN_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : returns.length === 0 ? (
        <EmptyState title="Sin devoluciones" description="No hay devoluciones que coincidan con el filtro." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Código</th>
                <th className={TH}>Centro de costo</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Activos</th>
                <th className={TH}>Solicitante</th>
                <th className={TH}>Creada</th>
                <th className={TH}>Enviada</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {returns.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-medium text-slate-900">{item.code ?? "Sin guía"}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {item.costCenter ? `${item.costCenter.code} · ${item.costCenter.name}` : "-"}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RETURN_STATUS_CLASSES[item.status]}`}>
                      {RETURN_STATUS_LABELS[item.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {item.status === "SENT" || item.status === "RECEIVED"
                      ? `${item.receivedCount} de ${item.lineCount} recibidos`
                      : item.lineCount}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{item.requestedBy?.fullName ?? "-"}</td>
                  <td className="px-4 py-2 text-slate-600">{formatDateTime(item.createdAt)}</td>
                  <td className="px-4 py-2 text-slate-600">{formatDateTime(item.sentAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <Button type="button" variant="secondary" onClick={() => onOpen(item.id)}>
                      Abrir
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

// Paso 1: modo + (centro de costo) + activos + notas -> borrador. La guia se adjunta en el detalle.
//  - "Mis equipos": los asignados al propio solicitante. El centro de costo lo define el equipo y NO se puede
//    modificar (por eso no hay selector).
//  - "Equipos de otro usuario": el solicitante elige el centro de costo.
// El servidor exige la misma regla (409): esto solo evita ofrecer lo que fallaria.
function NewReturn({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: number) => void }) {
  const navigate = useNavigate();
  const [scope, setScope] = useState<AssetReturnScope>("OWN");
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [costCenterId, setCostCenterId] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadCostCenters(): Promise<void> {
      try {
        const res = await costCenterService.list({ limit: 1000, sortBy: "code" });
        if (!cancelled) setCostCenters(res.items);
      } catch (error) {
        if (!cancelled) handleError(error, navigate);
      }
    }
    void loadCostCenters();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleCreate(assetIds: number[]): Promise<void> {
    setCreating(true);
    try {
      const created = await assetReturnService.create({
        scope,
        costCenterId: scope === "OTHERS" ? Number(costCenterId) : undefined,
        assetIds,
        notes: notes.trim() || undefined,
      });
      showSuccessToast("Devolución creada en borrador. Adjunte la guía de despacho para poder enviarla.");
      onCreated(created.id);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          ← Volver al listado
        </Button>
      </div>

      <fieldset className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <legend className="px-1 text-sm font-medium text-slate-700">¿Qué equipos devuelve?</legend>
        <div className="flex flex-wrap gap-6">
          {(["OWN", "OTHERS"] as const).map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="returnScope"
                value={option}
                checked={scope === option}
                onChange={() => {
                  setScope(option);
                  setCostCenterId("");
                }}
              />
              {RETURN_SCOPE_LABELS[option]}
            </label>
          ))}
        </div>
        {scope === "OWN" && (
          <p className="mt-2 text-sm text-slate-600">
            El centro de costo lo define cada equipo y no se puede modificar. Si sus equipos están en distintos centros
            de costo, haga una devolución por cada uno.
          </p>
        )}
      </fieldset>

      <div className="mb-4 grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
        {scope === "OTHERS" && (
          <Field label="Centro de costo de origen" htmlFor="returnCostCenter">
            <Select
              id="returnCostCenter"
              value={costCenterId}
              onChange={(e) => setCostCenterId(e.target.value)}
              className="bg-zinc-100"
            >
              <option value="">Seleccione...</option>
              {costCenters.map((costCenter) => (
                <option key={costCenter.id} value={costCenter.id}>
                  {costCenter.code} · {costCenter.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Notas (opcional)" htmlFor="returnNotes">
          <Textarea
            id="returnNotes"
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="bg-zinc-100"
          />
        </Field>
      </div>

      {scope === "OTHERS" && costCenterId === "" ? (
        <EmptyState
          title="Elija un centro de costo"
          description="Se listarán los activos asignados a otros usuarios de ese centro que pueden devolverse."
        />
      ) : (
        <CandidatePicker
          key={scope}
          scope={scope}
          costCenterId={scope === "OTHERS" ? Number(costCenterId) : undefined}
          confirmLabel="Crear devolución"
          busy={creating}
          onConfirm={handleCreate}
        />
      )}
    </div>
  );
}
