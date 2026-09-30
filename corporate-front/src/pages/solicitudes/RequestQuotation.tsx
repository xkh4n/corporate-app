import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Input, Button, EmptyState } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { costCenterService, purchaseRequestService } from "../../services";
import type { CostCenter, PurchaseRequest } from "../../types";

// purchase-requests:read para poder listar, quotes:create para poder abrir
// la etapa de cotizacion (POST /purchase-requests/:id/request-quotation
// exige ese permiso, no uno propio -ver purchaseRequest.routes.ts).
const REQUIRED_PERMISSIONS = ["purchase-requests:read", "quotes:create"] as const;

export default function RequestQuotation() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [search, setSearch] = useState("");
  const [requestingId, setRequestingId] = useState<number | null>(null);

  const costCenterNameById = new Map(costCenters.map((item) => [item.id, item.name]));

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const [requestsRes, costCentersRes] = await Promise.all([
        purchaseRequestService.list({ status: "APPROVED", limit: 100, search: search.trim() || undefined }),
        costCenterService.list({ limit: 1000 }),
      ]);
      setRequests(requestsRes.items);
      setCostCenters(costCentersRes.items);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, search]);

  async function handleRequestQuotation(request: PurchaseRequest): Promise<void> {
    setRequestingId(request.id);
    try {
      await purchaseRequestService.requestQuotation(request.id);
      showSuccessToast(`Cotización solicitada para ${request.requestNumber}`);
      await load();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setRequestingId(null);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          Solicitar Cotización
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
            <EmptyState
              title="Sin solicitudes"
              description="No hay solicitudes aprobadas esperando que se les solicite cotización."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">N° Solicitud</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Solicitante</th>
                    <th className="min-w-[10rem] px-4 py-2 text-left font-semibold text-slate-600">Centro de Costo</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Prioridad</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">{request.requestNumber}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {request.requester.firstName} {request.requester.lastName}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {costCenterNameById.get(request.costCenterId) ?? request.costCenterId}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{request.priority}</td>
                      <td className="whitespace-nowrap px-4 py-2">
                        <Button
                          type="button"
                          variant="success"
                          loading={requestingId === request.id}
                          onClick={() => void handleRequestQuotation(request)}
                        >
                          Solicitar Cotización
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
