import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Field, Button, Input, Select, EmptyState } from "../../components/ui";
import { showSuccessToast, showErrorToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { IsRut } from "../../lib/Validations";
import { assetMovementService, assetService } from "../../services";
import type { Asset } from "../../types";
import type { AssetRamCapacity, AssetStorageCapacity } from "../../types/assetMovement";

const STORAGE_OPTIONS: AssetStorageCapacity[] = ["512 GB", "1 TB"];
const RAM_OPTIONS: AssetRamCapacity[] = ["8 GB", "16 GB", "32 GB"];

// Pantalla independiente de asignacion (reemplaza el recorrido anterior
// "solicitud -> unidades -> asignar", ver RequestAssetStatus.tsx para el
// visor de solo lectura que quedo en su lugar): se busca el activo
// DIRECTO por tag o N° de serie, sin pasar por ninguna solicitud de compra:
// la asignacion es independiente del flujo de compras, con los campos que
// corporate-app realmente tiene.
const REQUIRED_PERMISSIONS = ["assets:read", "asset-movements:create"] as const;

// Formatea en vivo mientras se tipea: deja solo hex, agrupa de a 2 con ":".
function formatMacAddress(value: string): string {
  const hex = value.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 12);
  return hex.match(/.{1,2}/g)?.join(":") ?? hex;
}

const EMPTY_FORM = {
  documentId: "",
  userId: null as number | null,
  userName: "",
  supervisorName: "",
  macAddress: "",
  storageCapacity: "" as AssetStorageCapacity | "",
  ramCapacity: "" as AssetRamCapacity | "",
  hasBag: false,
  hasLock: false,
  hasCharger: false,
};

export default function AssignAsset() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [validating, setValidating] = useState(false);
  const [assigning, setAssigning] = useState(false);

  function resetForm(): void {
    setForm(EMPTY_FORM);
  }

  function handleChangeAsset(): void {
    setSelectedAsset(null);
    setCandidates([]);
    resetForm();
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
      // Sin filtro de status en el backend (el resultado de una busqueda por
      // tag/serie es chico) -se filtra aca a AVAILABLE, mismo criterio que
      // el listado que antes mostraba RequestAssetStatus.tsx.
      const available = res.items.filter((asset) => asset.status.code === "AVAILABLE");
      if (available.length === 0) {
        showErrorToast("No se encontró ningún activo disponible con ese criterio");
        setCandidates([]);
        return;
      }
      if (available.length === 1) {
        setSelectedAsset(available[0] ?? null);
        setCandidates([]);
      } else {
        setCandidates(available);
      }
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSearching(false);
    }
  }

  async function handleValidateUser(): Promise<void> {
    const documentId = form.documentId.trim();
    if (!documentId || !IsRut(documentId)) {
      showErrorToast("El RUT no es válido");
      return;
    }
    setValidating(true);
    try {
      const users = await assetMovementService.listAssignableUsers(documentId);
      // Match exacto de documentId -mismo criterio que el beneficiario de la
      // solicitud de equipo-, para no asignar por error a un RUT parecido (la
      // busqueda del servidor es por LIKE).
      const found = users.find((user) => user.person.documentId === documentId);
      if (!found) {
        showErrorToast("No existe un usuario activo con ese RUT");
        setForm((prev) => ({ ...prev, userId: null, userName: "" }));
        return;
      }
      setForm((prev) => ({ ...prev, userId: found.id, userName: `${found.person.firstName} ${found.person.lastName}` }));
      showSuccessToast("Usuario encontrado");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setValidating(false);
    }
  }

  async function handleAssign(): Promise<void> {
    if (!selectedAsset || !form.userId) return;

    setAssigning(true);
    try {
      const movement = await assetMovementService.assign({
        assetId: selectedAsset.id,
        userId: form.userId,
        supervisorName: form.supervisorName.trim() || undefined,
        macAddress: form.macAddress.trim() || undefined,
        storageCapacity: form.storageCapacity || undefined,
        ramCapacity: form.ramCapacity || undefined,
        hasBag: form.hasBag,
        hasLock: form.hasLock,
        hasCharger: form.hasCharger,
      });
      showSuccessToast(`Activo ${selectedAsset.tag} asignado a ${form.userName}`);

      // Descarga automatica del acta de entrega: un blob que se baja solo,
      // sin bloquear el resto del flujo si falla (la asignacion ya se hizo).
      try {
        const blob = await assetMovementService.downloadHandover(movement.id);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `acta-${selectedAsset.tag}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      } catch (pdfError) {
        handleError(pdfError, navigate);
      }

      setSearch("");
      handleChangeAsset();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setAssigning(false);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Asignación de Activos</h1>

        <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            {!selectedAsset ? (
              <>
                <Field label="Tag o N° de serie del activo" htmlFor="assetSearch">
                  <div className="flex gap-2">
                    <Input
                      id="assetSearch"
                      value={search}
                      placeholder="Ej: ACT000000001"
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
                          <th className="px-3 py-2 text-left font-semibold text-slate-600"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {candidates.map((asset) => (
                          <tr key={asset.id}>
                            <td className="px-3 py-2 font-medium text-slate-900">{asset.tag}</td>
                            <td className="px-3 py-2 text-slate-600">{asset.serialNumber ?? "-"}</td>
                            <td className="px-3 py-2">
                              <Button type="button" variant="secondary" onClick={() => setSelectedAsset(asset)}>
                                Seleccionar
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between rounded-md bg-emerald-50 px-4 py-3">
                  <div>
                    <p className="font-semibold text-slate-800">
                      {selectedAsset.tag}
                      {selectedAsset.serialNumber && (
                        <span className="text-slate-500 font-normal"> — N/S {selectedAsset.serialNumber}</span>
                      )}
                    </p>
                    <p className="text-sm text-slate-600">
                      Centro de costo:{" "}
                      {selectedAsset.costCenter ? `${selectedAsset.costCenter.code} - ${selectedAsset.costCenter.name}` : "Sin centro de costo"}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" onClick={handleChangeAsset}>
                    Cambiar
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-4 min-[800px]:grid-cols-3">
                  <Field label="RUT del empleado" htmlFor="documentId">
                    <div className="flex gap-2">
                      <Input
                        id="documentId"
                        value={form.documentId}
                        maxLength={20}
                        placeholder="Ej: 12.667.399-4"
                        onChange={(e) => setForm((prev) => ({ ...prev, documentId: e.target.value, userId: null, userName: "" }))}
                        className="bg-zinc-100 focus:bg-indigo-100"
                      />
                      <Button type="button" variant="secondary" loading={validating} onClick={() => void handleValidateUser()}>
                        Validar
                      </Button>
                    </div>
                  </Field>
                  <Field label="Empleado" htmlFor="userName">
                    <Input
                      id="userName"
                      value={form.userName}
                      placeholder="Se completa al validar el RUT"
                      disabled
                      className="bg-zinc-200 text-zinc-500"
                    />
                  </Field>
                  <Field label="Jefe directo (opcional)" htmlFor="supervisorName">
                    <Input
                      id="supervisorName"
                      value={form.supervisorName}
                      maxLength={150}
                      onChange={(e) => setForm((prev) => ({ ...prev, supervisorName: e.target.value }))}
                      className="bg-zinc-100 focus:bg-indigo-100"
                    />
                  </Field>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 min-[800px]:grid-cols-3">
                  <Field label="MAC del equipo (opcional)" htmlFor="macAddress">
                    <Input
                      id="macAddress"
                      value={form.macAddress}
                      placeholder="AA:BB:CC:DD:EE:FF"
                      onChange={(e) => setForm((prev) => ({ ...prev, macAddress: formatMacAddress(e.target.value) }))}
                      className="bg-zinc-100 focus:bg-indigo-100"
                    />
                  </Field>
                  <Field label="Almacenamiento (opcional)" htmlFor="storageCapacity">
                    <Select
                      id="storageCapacity"
                      value={form.storageCapacity}
                      onChange={(e) => setForm((prev) => ({ ...prev, storageCapacity: e.target.value as AssetStorageCapacity | "" }))}
                    >
                      <option value="">Seleccione almacenamiento</option>
                      {STORAGE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Memoria RAM (opcional)" htmlFor="ramCapacity">
                    <Select
                      id="ramCapacity"
                      value={form.ramCapacity}
                      onChange={(e) => setForm((prev) => ({ ...prev, ramCapacity: e.target.value as AssetRamCapacity | "" }))}
                    >
                      <option value="">Seleccione memoria</option>
                      {RAM_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div className="mt-4 flex flex-wrap gap-6">
                  <label className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.hasBag}
                      onChange={(e) => setForm((prev) => ({ ...prev, hasBag: e.target.checked }))}
                    />
                    ¿Incluye bolso?
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.hasLock}
                      onChange={(e) => setForm((prev) => ({ ...prev, hasLock: e.target.checked }))}
                    />
                    ¿Incluye candado?
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.hasCharger}
                      onChange={(e) => setForm((prev) => ({ ...prev, hasCharger: e.target.checked }))}
                    />
                    ¿Incluye cargador?
                  </label>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => { handleChangeAsset(); setSearch(""); }}>
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="success"
                    loading={assigning}
                    disabled={!form.userId}
                    onClick={() => void handleAssign()}
                    className="w-60"
                  >
                    Guardar Asignación
                  </Button>
                </div>
              </>
            )}

            {!selectedAsset && candidates.length === 0 && !searching && (
              <div className="mt-4">
                <EmptyState
                  title="Busca un activo para empezar"
                  description="Ingresa el tag o el número de serie de una unidad AVAILABLE para asignarla."
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </RequirePermissions>
  );
}
