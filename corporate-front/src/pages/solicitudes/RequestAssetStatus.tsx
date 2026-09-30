import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Button, Input, EmptyState } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { assetService, purchaseRequestService } from "../../services";
import type { Asset, PurchaseRequest } from "../../types";

// Visor de SOLO LECTURA del estado de activos por solicitud -reemplaza el
// recorrido de asignacion que antes vivia aca (ver AssignAsset.tsx, ahora en
// /assets/assign, pantalla independiente que no pasa por ninguna solicitud).
// Se conserva la misma logica de listado (AVAILABLE: todavia falta recibir
// algo de la solicitud, pero ya hay unidades recibidas para ver. DELIVERED:
// la recepcion ya se completo del todo -igual puede haber stock de respaldo
// sin asignar).
const REQUIRED_PERMISSIONS = ["purchase-requests:read", "assets:read"] as const;

export default function RequestAssetStatus() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [search, setSearch] = useState("");

  const [selectedRequest, setSelectedRequest] = useState<PurchaseRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
  const [assignedAssets, setAssignedAssets] = useState<Asset[]>([]);

  async function loadList(): Promise<void> {
    setLoading(true);
    try {
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
      setAvailableAssets(res.items.filter((asset) => asset.status.code === "AVAILABLE"));
      setAssignedAssets(res.items.filter((asset) => asset.status.code === "ASSIGNED"));
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
    setAvailableAssets([]);
    setAssignedAssets([]);
  }

  if (selectedRequest) {
    return (
      <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
        <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
          <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8">
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
                <h2 className="mb-3 text-sm font-semibold text-slate-600">Unidades disponibles</h2>
                {availableAssets.length === 0 ? (
                  <EmptyState title="Sin unidades" description="Esta solicitud no tiene unidades disponibles." />
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Tag</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">N° de serie</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {availableAssets.map((asset) => (
                          <tr key={asset.id}>
                            <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">{asset.tag}</td>
                            <td className="whitespace-nowrap px-4 py-2 text-slate-600">{asset.serialNumber ?? "-"}</td>
                            <td className="whitespace-nowrap px-4 py-2 text-slate-600">{asset.status.name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {assignedAssets.length > 0 && (
                  <div className="mt-6">
                    <h2 className="mb-3 text-sm font-semibold text-slate-600">Unidades ya asignadas</h2>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Tag</th>
                            <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">N° de serie</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {assignedAssets.map((asset) => (
                            <tr key={asset.id}>
                              <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">{asset.tag}</td>
                              <td className="whitespace-nowrap px-4 py-2 text-slate-600">{asset.serialNumber ?? "-"}</td>
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
      <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          Estado de Activos por Solicitud
        </h1>

        <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8">
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
            <EmptyState title="Sin resultados" description="No hay solicitudes con activos para mostrar." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">N° Solicitud</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Beneficiario</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Prioridad</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">{request.requestNumber}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {request.beneficiary.firstName} {request.beneficiary.lastName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{request.priority}</td>
                      <td className="whitespace-nowrap px-4 py-2">
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
