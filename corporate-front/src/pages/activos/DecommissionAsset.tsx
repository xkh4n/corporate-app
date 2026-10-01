import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Alert, Button, EmptyState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { assetMovementService, assetService } from "../../services";
import type { Asset } from "../../types";
import type { DecommissionCheck, DecommissionReason, SupplierReturnReason } from "../../types/assetMovement";

// Dar de Baja Activos (plan 012): baja operativa centralizada. Solo activos que
// estan en TI. Plan 018: segun el tag hay dos caminos:
//  - ACT (compra): baja con motivo y foto, exige clasificacion contable y sigue a Baja Contable.
//  - ARR/SRV (arriendo o servicio): se devuelve a su proveedor y sale del estado de pago, sin
//    proceso contable. Foto opcional.
const REQUIRED_PERMISSIONS = ["assets:read", "asset-decommissions:create"] as const;
const DECOMMISSIONABLE_STATUS_CODES = ["RETURNED", "SUPPORT", "DAMAGED", "AVAILABLE", "RECEIVED"];
const HELD_STATUS_CODES = ["ASSIGNED", "DEVALUATED"];
const ACCOUNTING_TAG_PREFIX = "ACT";

const REASON_OPTIONS: { value: DecommissionReason; label: string }[] = [
  { value: "OBSOLESCENCE", label: "Obsolescencia" },
  { value: "IRREPARABLE_DAMAGE", label: "Daño irreparable" },
  { value: "THEFT_LOSS", label: "Robo / Pérdida" },
  { value: "OTHER", label: "Otro" },
];

const SUPPLIER_REASON_OPTIONS: { value: SupplierReturnReason; label: string }[] = [
  { value: "END_OF_CONTRACT", label: "Término de contrato" },
  { value: "FAILURE", label: "Falla / daño" },
  { value: "REPLACEMENT", label: "Recambio de equipo" },
  { value: "OTHER", label: "Otro" },
];

const CLASSIFICATION_LABEL: Record<string, string> = { FIXED_ASSET: "Activo fijo", EXPENSE: "Gasto" };

// Plan 013: foto obligatoria, la misma que luego usa Baja Contable. Mismo tope que la API.
const PHOTO_TYPES = ["image/jpeg", "image/png"];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// Un arriendo/servicio con una baja de antes del plan 018 ya no puede ir a Baja Contable: se devuelve al proveedor.
function canProcess(asset: Asset): boolean {
  if (DECOMMISSIONABLE_STATUS_CODES.includes(asset.status.code)) return true;
  return asset.status.code === "DECOMMISSIONED" && !asset.tag.startsWith(ACCOUNTING_TAG_PREFIX);
}

function today(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

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
  const [supplierReason, setSupplierReason] = useState<SupplierReturnReason | "">("");
  const [paymentExitDate, setPaymentExitDate] = useState(today);
  const [supplierDocument, setSupplierDocument] = useState("");
  const [detail, setDetail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const supplierFlow = check?.flow === "SUPPLIER_RETURN";

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function handlePhotoSelected(files: FileList | null): void {
    const file = files?.[0] ?? null;
    if (photoInputRef.current) photoInputRef.current.value = "";
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type) || file.size > MAX_PHOTO_BYTES) {
      showErrorToast("La foto debe ser JPEG o PNG de hasta 5 MB");
      return;
    }
    setPhoto(file);
  }

  function reset(): void {
    setCheck(null);
    setCandidates([]);
    setReason("");
    setSupplierReason("");
    setPaymentExitDate(today());
    setSupplierDocument("");
    setDetail("");
    setPhoto(null);
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
      const found = res.items.filter(canProcess);
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

  const selectedReason = supplierFlow ? supplierReason : reason;
  const detailRequired = selectedReason === "OTHER";
  const canSubmit =
    check?.eligible === true &&
    selectedReason !== "" &&
    (!detailRequired || detail.trim() !== "") &&
    (supplierFlow ? paymentExitDate !== "" : photo !== null);

  async function handleSubmit(): Promise<void> {
    if (!check || !canSubmit) return;
    setSaving(true);
    try {
      if (supplierFlow) {
        if (supplierReason === "") return;
        await assetMovementService.returnToSupplier({
          assetId: check.assetId,
          reason: supplierReason,
          paymentExitDate,
          detail: detail.trim() || undefined,
          supplierDocument: supplierDocument.trim() || undefined,
          photo: photo ?? undefined,
        });
        showSuccessToast(`Activo ${check.tag} devuelto a su proveedor: sale del estado de pago el ${paymentExitDate}.`);
      } else {
        if (reason === "" || !photo) return;
        await assetMovementService.decommission({ assetId: check.assetId, reason, detail: detail.trim() || undefined, photo });
        showSuccessToast(`Activo ${check.tag} dado de baja: queda Pendiente de baja contable.`);
      }
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
      <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Dar de Baja Activos</h1>

        <div className="w-full max-w-3xl mx-auto sm:px-6 lg:px-8">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            {!check ? (
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
                      description="Solo se procesan activos que están en Sistemas (devueltos, en soporte, dañados o disponibles). Los ACT se dan de baja y pasan a Contabilidad; los arriendos y servicios (ARR/SRV) se devuelven a su proveedor."
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mb-4 flex items-start justify-between gap-2 rounded-md bg-slate-50 px-4 py-3">
                  <div className="min-w-0 break-words">
                    <p className="font-semibold text-slate-800">
                      {check.tag}
                      {check.serialNumber && <span className="text-slate-500 font-normal"> — N/S {check.serialNumber}</span>}
                    </p>
                    <p className="text-sm text-slate-600">Estado: {check.statusName}</p>
                    <p className="text-sm text-slate-600">
                      Centro de costo: {check.costCenter ? `${check.costCenter.code} - ${check.costCenter.name}` : "Sin centro de costo"}
                    </p>
                    {!supplierFlow && (
                      <p className="text-sm text-slate-600">
                        Clasificación contable:{" "}
                        {check.classification ? (CLASSIFICATION_LABEL[check.classification] ?? check.classification) : "Sin clasificar"}
                      </p>
                    )}
                  </div>
                  <Button type="button" variant="ghost" onClick={reset}>
                    Cambiar
                  </Button>
                </div>

                <div className="mb-4">
                  {supplierFlow ? (
                    <Alert tone="info">
                      <strong>Arriendo o servicio:</strong> se devuelve a su proveedor y sale del estado de pago en la
                      fecha indicada. No pasa por Contabilidad.
                    </Alert>
                  ) : (
                    <Alert tone="info">
                      <strong>Activo contable (ACT):</strong> queda Pendiente de baja contable y Contabilidad lo da de
                      baja definitivamente en Baja Contable.
                    </Alert>
                  )}
                </div>

                {check.blockReason ? (
                  <Alert tone="warning">{check.blockReason}</Alert>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {supplierFlow ? (
                      <>
                        <Field label="Motivo de la devolución" htmlFor="supplierReason">
                          <Select
                            id="supplierReason"
                            value={supplierReason}
                            onChange={(e) => setSupplierReason(e.target.value as SupplierReturnReason | "")}
                          >
                            <option value="">Seleccione un motivo</option>
                            {SUPPLIER_REASON_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <Field label="Sale del estado de pago el" htmlFor="paymentExitDate">
                            <Input
                              id="paymentExitDate"
                              type="date"
                              value={paymentExitDate}
                              onChange={(e) => setPaymentExitDate(e.target.value)}
                            />
                          </Field>
                          <Field label="N° de guía o acta del proveedor (opcional)" htmlFor="supplierDocument">
                            <Input
                              id="supplierDocument"
                              value={supplierDocument}
                              maxLength={50}
                              onChange={(e) => setSupplierDocument(e.target.value)}
                            />
                          </Field>
                        </div>
                      </>
                    ) : (
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
                    )}
                    <Field label={detailRequired ? "Detalle (obligatorio)" : "Detalle (opcional)"} htmlFor="detail">
                      <Textarea id="detail" value={detail} maxLength={200} rows={2} onChange={(e) => setDetail(e.target.value)} />
                    </Field>
                    <Field label={supplierFlow ? "Foto del activo (opcional)" : "Foto del activo (obligatoria)"} htmlFor="photo">
                      <div className="flex flex-wrap items-center gap-3">
                        {photoPreview && (
                          <img
                            src={photoPreview}
                            alt={`Foto de ${check.tag}`}
                            className="h-24 w-24 rounded border border-slate-200 object-cover"
                          />
                        )}
                        <Button type="button" variant="secondary" onClick={() => photoInputRef.current?.click()}>
                          {photo ? "Cambiar foto" : "Tomar o subir foto"}
                        </Button>
                        {photo && supplierFlow && (
                          <Button type="button" variant="ghost" onClick={() => setPhoto(null)}>
                            Quitar foto
                          </Button>
                        )}
                        <input
                          ref={photoInputRef}
                          id="photo"
                          type="file"
                          accept="image/jpeg,image/png"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => handlePhotoSelected(e.target.files)}
                        />
                      </div>
                    </Field>
                  </div>
                )}

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
                  <Button type="button" disabled={!canSubmit} onClick={() => setConfirming(true)} className="sm:w-60">
                    {supplierFlow ? "Devolver al proveedor" : "Dar de baja"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        <Modal
          open={confirming && check !== null}
          title={check ? `${supplierFlow ? "Devolver al proveedor" : "Dar de baja"} ${check.tag}` : ""}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
              <Button type="button" loading={saving} onClick={() => void handleSubmit()}>
                {supplierFlow ? "Confirmar devolución" : "Confirmar baja"}
              </Button>
            </>
          }
        >
          {supplierFlow ? (
            <p className="text-sm text-slate-700">
              El activo queda <strong>Devuelto a proveedor</strong>, de forma definitiva, y su Kardex en cero. Sale del
              estado de pago el <strong>{paymentExitDate}</strong>. No pasa por Contabilidad.
            </p>
          ) : (
            <p className="text-sm text-slate-700">
              El activo queda <strong>Pendiente de baja contable</strong> y su Kardex en cero. Contabilidad lo da de baja
              definitivamente en Baja Contable (de a uno o por lote), con la foto que adjunta aquí.
            </p>
          )}
        </Modal>
      </div>
    </RequirePermissions>
  );
}
