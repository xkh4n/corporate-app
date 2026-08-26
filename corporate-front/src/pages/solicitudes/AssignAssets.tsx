import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Field, Button, Input, EmptyState } from "../../components/ui";
import { showSuccessToast, showErrorToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { IsRut } from "../../lib/Validations";
import { assetMovementService, assetService, purchaseRequestService } from "../../services";
import type { Asset, PurchaseRequest } from "../../types";

// Paso 9 (ultimo) del flujo: asignar cada unidad recibida (Asset AVAILABLE,
// una fila por unidad -decision B del plan) a un empleado. El cierre de la
// solicitud a DELIVERED ya paso en createGoodsReceipt cuando lo recibido
// cubrio lo autorizado -asignar NO lo dispara ni depende de el, asi que esta
// pantalla lista solicitudes AVAILABLE (recepcion parcial, todavia falta
// recibir) y DELIVERED (ya recibido completo, pero puede quedar stock de
// respaldo sin asignar a nadie) por igual.
const REQUIRED_PERMISSIONS = ["purchase-requests:read", "assets:read", "asset-movements:create"] as const;

interface AssetRow {
  asset: Asset;
  documentId: string;
  userId: number | null;
  userName: string;
  validating: boolean;
  assigning: boolean;
}

export default function AssignAssets() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [search, setSearch] = useState("");

  const [selectedRequest, setSelectedRequest] = useState<PurchaseRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [assignedAssets, setAssignedAssets] = useState<Asset[]>([]);
  const [assetRows, setAssetRows] = useState<AssetRow[]>([]);

  async function loadList(): Promise<void> {
    setLoading(true);
    try {
      // AVAILABLE: todavia falta recibir algo de la solicitud, pero ya hay
      // unidades recibidas para asignar. DELIVERED: la recepcion ya se
      // completo del todo -igual puede haber stock de respaldo sin asignar.
      const res = await purchaseRequestService.list({
        status: "AVAILABLE,DELIVERED",
        limit: 100,
        search: search.trim() || undefined,
      });
      setRequests(res.items);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, search]);

  async function loadDetail(requestId: number): Promise<void> {
    setDetailLoading(true);
    try {
      const res = await assetService.list({ requestId, limit: 1000 });
      const available = res.items.filter((asset) => asset.status.code === "AVAILABLE");
      setAssignedAssets(res.items.filter((asset) => asset.status.code === "ASSIGNED"));
      setAssetRows(
        available.map((asset) => ({
          asset,
          documentId: "",
          userId: null,
          userName: "",
          validating: false,
          assigning: false,
        })),
      );
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleViewRequest(request: PurchaseRequest): Promise<void> {
    setSelectedRequest(request);
    await loadDetail(request.id);
  }

  function handleBackToList(): void {
    setSelectedRequest(null);
    setAssignedAssets([]);
    setAssetRows([]);
  }

  function updateRow(assetId: number, patch: Partial<AssetRow>): void {
    setAssetRows((prev) => prev.map((row) => (row.asset.id === assetId ? { ...row, ...patch } : row)));
  }

  function handleDocumentIdChange(assetId: number, value: string): void {
    updateRow(assetId, { documentId: value, userId: null, userName: "" });
  }

  async function handleValidateUser(assetId: number): Promise<void> {
    const row = assetRows.find((item) => item.asset.id === assetId);
    if (!row) return;
    const documentId = row.documentId.trim();
    if (!documentId || !IsRut(documentId)) {
      showErrorToast("El RUT no es valido");
      return;
    }
    updateRow(assetId, { validating: true });
    try {
      const users = await assetMovementService.listAssignableUsers(documentId);
      // Busqueda por LIKE del lado del servidor -se exige match exacto de
      // documentId aca, mismo criterio que handleValidateBeneficiary en
      // CreateRequest.tsx, para no asignar por error a un RUT parecido.
      const found = users.find((user) => user.person.documentId === documentId);
      if (!found) {
        showErrorToast("No existe un usuario activo con ese RUT");
        updateRow(assetId, { userId: null, userName: "" });
        return;
      }
      updateRow(assetId, { userId: found.id, userName: `${found.person.firstName} ${found.person.lastName}` });
      showSuccessToast("Usuario encontrado");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      updateRow(assetId, { validating: false });
    }
  }

  async function handleAssign(assetId: number): Promise<void> {
    if (!selectedRequest) return;
    const row = assetRows.find((item) => item.asset.id === assetId);
    if (!row?.userId) return;

    const wasLastAvailable = assetRows.length <= 1;
    updateRow(assetId, { assigning: true });
    try {
      await assetMovementService.assign({ assetId, userId: row.userId });
      showSuccessToast(`Activo ${row.asset.tag} asignado a ${row.userName}`);

      // Asignar ya no cambia el estado de la solicitud (ver
      // assignAssetToUser en assetMovement.service.ts) -solo se refresca el
      // detalle. Si no queda ninguna unidad AVAILABLE, se avisa pero se deja
      // al usuario volver al listado cuando quiera (puede quedar stock de
      // respaldo sin asignar a proposito).
      await loadDetail(selectedRequest.id);
      if (wasLastAvailable) {
        showSuccessToast(`Solicitud ${selectedRequest.requestNumber}: no quedan mas unidades disponibles para asignar`);
      }
    } catch (error) {
      handleError(error, navigate);
      updateRow(assetId, { assigning: false });
    }
  }

  if (selectedRequest) {
    return (
      <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
        <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
          <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
            <Button type="button" variant="secondary" onClick={handleBackToList} className="mb-4">
              Volver al listado
            </Button>

            <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl font-bold text-gray-600">Solicitud {selectedRequest.requestNumber}</h1>
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                  {selectedRequest.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                <span className="font-semibold text-slate-700">Beneficiario:</span> {selectedRequest.beneficiary.firstName}{" "}
                {selectedRequest.beneficiary.lastName}
              </p>
            </div>

            {detailLoading ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : (
              <>
                <h2 className="mb-3 text-sm font-semibold text-slate-600">Unidades disponibles para asignar</h2>
                {assetRows.length === 0 ? (
                  <EmptyState title="Sin unidades" description="Esta solicitud no tiene unidades disponibles para asignar." />
                ) : (
                  <div className="space-y-3">
                    {assetRows.map((row) => (
                      <div key={row.asset.id} className="rounded-lg border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-semibold text-slate-800">
                            {row.asset.tag}
                            {row.asset.serialNumber && (
                              <span className="text-slate-500 font-normal"> — N/S {row.asset.serialNumber}</span>
                            )}
                          </h3>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-4 min-[800px]:grid-cols-3">
                          <Field label="RUT del empleado" htmlFor={`documentId-${row.asset.id}`}>
                            <div className="flex gap-2">
                              <Input
                                id={`documentId-${row.asset.id}`}
                                value={row.documentId}
                                maxLength={20}
                                placeholder="Ej: 12.667.399-4"
                                onChange={(e) => handleDocumentIdChange(row.asset.id, e.target.value)}
                                className="bg-zinc-100 focus:bg-indigo-100"
                              />
                              <Button
                                type="button"
                                variant="secondary"
                                loading={row.validating}
                                onClick={() => void handleValidateUser(row.asset.id)}
                              >
                                Validar
                              </Button>
                            </div>
                          </Field>
                          <Field label="Empleado" htmlFor={`userName-${row.asset.id}`}>
                            <Input
                              id={`userName-${row.asset.id}`}
                              value={row.userName}
                              placeholder="Se completa al validar el RUT"
                              disabled
                              className="bg-zinc-200 text-zinc-500"
                            />
                          </Field>
                          <div className="flex items-end">
                            <Button
                              type="button"
                              variant="success"
                              loading={row.assigning}
                              disabled={!row.userId}
                              onClick={() => void handleAssign(row.asset.id)}
                              className="w-full"
                            >
                              Asignar
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {assignedAssets.length > 0 && (
                  <div className="mt-6">
                    <h2 className="mb-3 text-sm font-semibold text-slate-600">Unidades ya asignadas</h2>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Tag</th>
                            <th className="px-4 py-2 text-left font-semibold text-slate-600">N° de serie</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {assignedAssets.map((asset) => (
                            <tr key={asset.id}>
                              <td className="px-4 py-2 font-medium text-slate-900">{asset.tag}</td>
                              <td className="px-4 py-2 text-slate-600">{asset.serialNumber ?? "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </RequirePermissions>
    );
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Asignar Activos</h1>

        <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-4 max-w-sm">
            <Input
              placeholder="Buscar por numero, notas o prioridad..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-white"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : requests.length === 0 ? (
            <EmptyState title="Sin pendientes" description="No hay solicitudes con activos disponibles para asignar." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">N° Solicitud</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Beneficiario</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Prioridad</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="px-4 py-2 font-medium text-slate-900">{request.requestNumber}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {request.beneficiary.firstName} {request.beneficiary.lastName}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{request.priority}</td>
                      <td className="px-4 py-2">
                        <Button type="button" variant="secondary" onClick={() => void handleViewRequest(request)}>
                          Ver
                        </Button>
                      </td>
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
