import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Field, Button, Input, Select, Textarea, EmptyState } from "../../components/ui";
import { showSuccessToast, showErrorToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { IsRut } from "../../lib/Validations";
import { assetMovementService, assetService, costCenterService } from "../../services";
import type { Asset } from "../../types";
import type { CostCenter } from "../../types/costCenter";
import type { CurrentAssignment } from "../../types/assetMovement";
import { HandoverFields } from "./HandoverFields";
import { EMPTY_HANDOVER, downloadHandover, handoverFromCurrent, toHandoverPayload, type HandoverForm } from "./handover";

// Reasignar Activos (plan 011): cambia el usuario, el centro de costo o ambos de
// un activo en uso. Siempre queda como movimiento con acta nueva, aunque solo
// cambie el centro de costo (decision del usuario).
const REQUIRED_PERMISSIONS = ["assets:read", "asset-movements:read", "asset-movements:create"] as const;
const HELD_STATUS_CODES = ["ASSIGNED", "DEVALUATED"];

interface TargetUser {
  documentId: string;
  userId: number | null;
  userName: string;
}

const EMPTY_TARGET: TargetUser = { documentId: "", userId: null, userName: "" };

function notHeldMessage(found: Asset[]): string {
  if (found.length === 0) return "No se encontró ningún activo con ese criterio";
  if (found.length === 1 && found[0]) {
    return `El activo ${found[0].tag} no está asignado a nadie (estado: ${found[0].status.name}): use Asignar Activos`;
  }
  return `Ningún activo con ese criterio está asignado: ${found
    .slice(0, 3)
    .map((asset) => `${asset.tag} (${asset.status.name})`)
    .join(", ")}${found.length > 3 ? "…" : ""}`;
}

export default function ReassignAsset() {
  const navigate = useNavigate();

  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<Asset[]>([]);
  const [current, setCurrent] = useState<CurrentAssignment | null>(null);

  const [target, setTarget] = useState<TargetUser>(EMPTY_TARGET);
  const [costCenterId, setCostCenterId] = useState("");
  const [handover, setHandover] = useState<HandoverForm>(EMPTY_HANDOVER);
  const [notes, setNotes] = useState("");
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    costCenterService
      .list({ limit: 1000, sortBy: "code" })
      .then((res) => setCostCenters(res.items))
      .catch((error: unknown) => handleError(error, navigate));
  }, [navigate]);

  function reset(): void {
    setCurrent(null);
    setCandidates([]);
    setTarget(EMPTY_TARGET);
    setCostCenterId("");
    setHandover(EMPTY_HANDOVER);
    setNotes("");
  }

  async function selectAsset(asset: Asset): Promise<void> {
    try {
      const assignment = await assetMovementService.current(asset.id);
      setCurrent(assignment);
      setCandidates([]);
      setHandover(handoverFromCurrent(assignment));
    } catch (error) {
      handleError(error, navigate);
    }
  }

  async function handleSearch(): Promise<void> {
    const query = search.trim();
    if (!query) {
      showErrorToast("Ingresa un tag o número de serie para buscar");
      return;
    }
    setSearching(true);
    try {
      const res = await assetService.list({ search: query, limit: 10 });
      const held = res.items.filter((asset) => HELD_STATUS_CODES.includes(asset.status.code));
      if (held.length === 0) {
        showErrorToast(notHeldMessage(res.items));
        setCandidates([]);
        return;
      }
      if (held.length === 1 && held[0]) {
        await selectAsset(held[0]);
      } else {
        setCandidates(held);
      }
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSearching(false);
    }
  }

  async function handleValidateUser(): Promise<void> {
    const documentId = target.documentId.trim();
    if (!documentId || !IsRut(documentId)) {
      showErrorToast("El RUT no es válido");
      return;
    }
    setValidating(true);
    try {
      const users = await assetMovementService.listAssignableUsers(documentId);
      // Match exacto del RUT: la busqueda del servidor es por LIKE.
      const found = users.find((user) => user.person.documentId === documentId);
      if (!found) {
        showErrorToast("No existe un usuario activo con ese RUT");
        setTarget((prev) => ({ ...prev, userId: null, userName: "" }));
        return;
      }
      if (current && found.id === current.holder.userId) {
        showErrorToast(`${current.holder.fullName} ya tiene este activo`);
        setTarget((prev) => ({ ...prev, userId: null, userName: "" }));
        return;
      }
      setTarget((prev) => ({ ...prev, userId: found.id, userName: `${found.person.firstName} ${found.person.lastName}` }));
      showSuccessToast("Usuario encontrado");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setValidating(false);
    }
  }

  const newCostCenterId = costCenterId ? Number(costCenterId) : null;
  const costCenterChanged = newCostCenterId !== null && newCostCenterId !== current?.costCenter?.id;
  const canSave = current !== null && (target.userId !== null || costCenterChanged);

  async function handleSave(): Promise<void> {
    if (!current || !canSave) return;
    setSaving(true);
    try {
      const movement = await assetMovementService.reassign({
        assetId: current.assetId,
        userId: target.userId ?? undefined,
        costCenterId: costCenterChanged && newCostCenterId !== null ? newCostCenterId : undefined,
        notes: notes.trim() || undefined,
        ...toHandoverPayload(handover),
      });
      showSuccessToast(`Activo ${current.tag} reasignado`);
      try {
        await downloadHandover(movement.id, current.tag);
      } catch (pdfError) {
        handleError(pdfError, navigate);
      }
      setSearch("");
      reset();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Reasignar Activos</h1>

        <div className="w-full max-w-3xl mx-auto sm:px-6 lg:px-8">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            {!current ? (
              <>
                <Field label="Tag o N° de serie del activo" htmlFor="assetSearch">
                  <div className="flex gap-2">
                    <Input
                      id="assetSearch"
                      value={search}
                      placeholder="Ej: ARR000000001"
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
                      className="bg-zinc-100 focus:bg-indigo-100"
                    />
                    <Button type="button" variant="secondary" loading={searching} onClick={() => void handleSearch()}>
                      Buscar
                    </Button>
                  </div>
                </Field>

                {candidates.length > 0 && (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Tag</th>
                          <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-600">N° de serie</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Estado</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {candidates.map((asset) => (
                          <tr key={asset.id}>
                            <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">{asset.tag}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-600">{asset.serialNumber ?? "-"}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-600">{asset.status.name}</td>
                            <td className="px-3 py-2">
                              <Button type="button" variant="secondary" className="whitespace-nowrap" onClick={() => void selectAsset(asset)}>
                                Seleccionar
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {candidates.length === 0 && !searching && (
                  <div className="mt-4">
                    <EmptyState
                      title="Busca un activo para empezar"
                      description="Ingresa el tag o el número de serie de un activo asignado para cambiarle el usuario o el centro de costo."
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mb-4 flex items-start justify-between gap-2 rounded-md bg-emerald-50 px-4 py-3">
                  <div className="min-w-0 break-words">
                    <p className="font-semibold text-slate-800">
                      {current.tag}
                      {current.serialNumber && <span className="text-slate-500 font-normal"> — N/S {current.serialNumber}</span>}
                      {current.statusCode === "DEVALUATED" && (
                        <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Devaluado</span>
                      )}
                    </p>
                    <p className="text-sm text-slate-600">Usuario actual: {current.holder.fullName}</p>
                    <p className="text-sm text-slate-600">
                      Centro de costo actual:{" "}
                      {current.costCenter ? `${current.costCenter.code} - ${current.costCenter.name}` : "Sin centro de costo"}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" onClick={reset}>
                    Cambiar
                  </Button>
                </div>

                <p className="mb-3 text-sm text-slate-600">
                  Indique un nuevo usuario, un nuevo centro de costo o ambos. Lo que deje en blanco se mantiene.
                </p>

                <div className="grid grid-cols-1 gap-4 min-[800px]:grid-cols-2">
                  <Field label="RUT del nuevo usuario (opcional)" htmlFor="documentId">
                    <div className="flex gap-2">
                      <Input
                        id="documentId"
                        value={target.documentId}
                        maxLength={20}
                        placeholder="Ej: 12.667.399-4"
                        onChange={(e) => setTarget({ documentId: e.target.value, userId: null, userName: "" })}
                        className="bg-zinc-100 focus:bg-indigo-100"
                      />
                      <Button type="button" variant="secondary" loading={validating} onClick={() => void handleValidateUser()}>
                        Validar
                      </Button>
                    </div>
                  </Field>
                  <Field label="Nuevo usuario" htmlFor="userName">
                    <Input
                      id="userName"
                      value={target.userName}
                      placeholder="Se mantiene el actual"
                      disabled
                      className="bg-zinc-200 text-zinc-500"
                    />
                  </Field>
                  <Field label="Nuevo centro de costo (opcional)" htmlFor="costCenterId">
                    <Select id="costCenterId" value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
                      <option value="">Se mantiene el actual</option>
                      {costCenters.map((costCenter) => (
                        <option key={costCenter.id} value={costCenter.id}>
                          {costCenter.code} - {costCenter.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div className="mt-4">
                  <HandoverFields value={handover} onChange={(patch) => setHandover((prev) => ({ ...prev, ...patch }))} />
                </div>

                <div className="mt-4">
                  <Field label="Observación (opcional)" htmlFor="notes">
                    <Textarea id="notes" value={notes} maxLength={200} rows={2} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                </div>

                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      reset();
                      setSearch("");
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="success"
                    loading={saving}
                    disabled={!canSave}
                    onClick={() => void handleSave()}
                    className="sm:w-60"
                  >
                    Guardar Reasignación
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </RequirePermissions>
  );
}
