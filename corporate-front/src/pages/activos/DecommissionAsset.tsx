import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Alert, Button, EmptyState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { assetMovementService, assetService } from "../../services";
import type { Asset } from "../../types";
import type { DecommissionCheck, DecommissionReason } from "../../types/assetMovement";

// Dar de Baja Activos (plan 012): baja operativa centralizada. Solo activos que
// estan en TI y ya clasificados contablemente (sin clasificacion nunca podrian
// ir a Baja Contable). El motivo queda en el movimiento y en el Kardex.
const REQUIRED_PERMISSIONS = ["assets:read", "asset-decommissions:create"] as const;
const DECOMMISSIONABLE_STATUS_CODES = ["RETURNED", "SUPPORT", "DAMAGED", "AVAILABLE", "RECEIVED"];
const HELD_STATUS_CODES = ["ASSIGNED", "DEVALUATED"];

const REASON_OPTIONS: { value: DecommissionReason; label: string }[] = [
  { value: "OBSOLESCENCE", label: "Obsolescencia" },
  { value: "IRREPARABLE_DAMAGE", label: "Daño irreparable" },
  { value: "THEFT_LOSS", label: "Robo / Pérdida" },
  { value: "OTHER", label: "Otro" },
];

const CLASSIFICATION_LABEL: Record<string, string> = { FIXED_ASSET: "Activo fijo", EXPENSE: "Gasto" };

function notDecommissionableMessage(found: Asset[]): string {
  if (found.length === 0) return "No se encontró ningún activo con ese criterio";
  if (found.length === 1 && found[0]) {
    const asset = found[0];
    return HELD_STATUS_CODES.includes(asset.status.code)
      ? `El activo ${asset.tag} está asignado: primero regístrelo en Devoluciones de Activos`
      : `El activo ${asset.tag} no se puede dar de baja (estado: ${asset.status.name})`;
  }
  return `Ningún activo con ese criterio se puede dar de baja: ${found
    .slice(0, 3)
    .map((asset) => `${asset.tag} (${asset.status.name})`)
    .join(", ")}${found.length > 3 ? "…" : ""}`;
}

export default function DecommissionAsset() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<Asset[]>([]);
  const [check, setCheck] = useState<DecommissionCheck | null>(null);
  const [reason, setReason] = useState<DecommissionReason | "">("");
  const [detail, setDetail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  function reset(): void {
    setCheck(null);
    setCandidates([]);
    setReason("");
    setDetail("");
    setConfirming(false);
  }

  async function selectAsset(asset: Asset): Promise<void> {
    try {
      setCheck(await assetMovementService.decommissionCheck(asset.id));
      setCandidates([]);
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
      const found = res.items.filter((asset) => DECOMMISSIONABLE_STATUS_CODES.includes(asset.status.code));
      if (found.length === 0) {
        showErrorToast(notDecommissionableMessage(res.items));
        setCandidates([]);
        return;
      }
      if (found.length === 1 && found[0]) {
        await selectAsset(found[0]);
      } else {
        setCandidates(found);
      }
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSearching(false);
    }
  }

  const detailRequired = reason === "OTHER";
  const canSubmit = check?.eligible === true && reason !== "" && (!detailRequired || detail.trim() !== "");

  async function handleDecommission(): Promise<void> {
    if (!check || !canSubmit) return;
    setSaving(true);
    try {
      await assetMovementService.decommission({ assetId: check.assetId, reason, detail: detail.trim() || undefined });
      showSuccessToast(`Activo ${check.tag} dado de baja. Ya puede incluirse en Baja Contable.`);
      setSearch("");
      reset();
    } catch (error) {
      handleError(error, navigate);
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Dar de Baja Activos</h1>

        <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            {!check ? (
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
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">N° de serie</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Estado</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {candidates.map((asset) => (
                          <tr key={asset.id}>
                            <td className="px-3 py-2 font-medium text-slate-900">{asset.tag}</td>
                            <td className="px-3 py-2 text-slate-600">{asset.serialNumber ?? "-"}</td>
                            <td className="px-3 py-2 text-slate-600">{asset.status.name}</td>
                            <td className="px-3 py-2">
                              <Button type="button" variant="secondary" onClick={() => void selectAsset(asset)}>
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
                      description="Solo se dan de baja activos que están en TI (devueltos, en soporte, dañados o disponibles) y ya clasificados contablemente."
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between rounded-md bg-slate-50 px-4 py-3">
                  <div>
                    <p className="font-semibold text-slate-800">
                      {check.tag}
                      {check.serialNumber && <span className="text-slate-500 font-normal"> — N/S {check.serialNumber}</span>}
                    </p>
                    <p className="text-sm text-slate-600">Estado: {check.statusName}</p>
                    <p className="text-sm text-slate-600">
                      Centro de costo: {check.costCenter ? `${check.costCenter.code} - ${check.costCenter.name}` : "Sin centro de costo"}
                    </p>
                    <p className="text-sm text-slate-600">
                      Clasificación contable:{" "}
                      {check.classification ? (CLASSIFICATION_LABEL[check.classification] ?? check.classification) : "Sin clasificar"}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" onClick={reset}>
                    Cambiar
                  </Button>
                </div>

                {check.blockReason ? (
                  <Alert tone="warning">{check.blockReason}</Alert>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    <Field label="Motivo de la baja" htmlFor="reason">
                      <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value as DecommissionReason | "")}>
                        <option value="">Seleccione un motivo</option>
                        {REASON_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={detailRequired ? "Detalle (obligatorio)" : "Detalle (opcional)"} htmlFor="detail">
                      <Textarea id="detail" value={detail} maxLength={200} rows={2} onChange={(e) => setDetail(e.target.value)} />
                    </Field>
                  </div>
                )}

                <div className="mt-6 flex justify-end gap-2">
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
                  <Button type="button" disabled={!canSubmit} onClick={() => setConfirming(true)} className="w-60">
                    Dar de baja
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        <Modal
          open={confirming && check !== null}
          title={check ? `Dar de baja ${check.tag}` : ""}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
              <Button type="button" loading={saving} onClick={() => void handleDecommission()}>
                Confirmar baja
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-700">
            La baja es definitiva: el activo queda <strong>De baja</strong> y su Kardex en cero. Después podrá incluirse en
            Baja Contable.
          </p>
        </Modal>
      </div>
    </RequirePermissions>
  );
}
