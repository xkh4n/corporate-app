import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Input, Button, EmptyState } from "../../components/ui";
import { showSuccessToast, showErrorToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { productService, purchaseRequestService, purchaseRequestLineService } from "../../services";
import type { PurchaseRequest, PurchaseRequestLine, PurchaseRequestStatus } from "../../types";

// Ademas de "purchase-requests:approve" (ver el listado de GET
// /purchase-requests/my-approvals y aprobar el estado de la cabecera), el
// detalle necesita permiso sobre las lineas: "read" para listarlas y
// "update" para poder aprobar/rechazar cada una -sin este ultimo, el PUT a
// purchase-request-lines/:id da 403 a mitad de camino al guardar.
const REQUIRED_PERMISSIONS = [
  "purchase-requests:approve",
  "purchase-request-lines:read",
  "purchase-request-lines:update",
] as const;

// Un color por estado (ver PurchaseRequestStatus, library/purchaseRequestStatus.ts
// en corporate-api): mismo criterio en toda la cadena, verde = avanzo,
// ambar = esperando accion de alguien, rojo/gris = terminal.
const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-200 text-slate-600",
  SUBMITTED: "bg-amber-100 text-amber-700",
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
  IN_QUOTATION: "bg-sky-100 text-sky-700",
  APPROVE_QUOTE: "bg-amber-100 text-amber-700",
  QUOTE_APPROVED: "bg-emerald-100 text-emerald-700",
  OC_GENERATED: "bg-sky-100 text-sky-700",
  PENDING_DELIVERY: "bg-amber-100 text-amber-700",
  AVAILABLE: "bg-emerald-100 text-emerald-700",
  DELIVERED: "bg-emerald-100 text-emerald-700",
  CLOSED: "bg-slate-200 text-slate-600",
  CANCELLED: "bg-slate-200 text-slate-600",
};

function statusBadgeClass(status: string): string {
  return STATUS_STYLES[status] ?? "bg-slate-200 text-slate-600";
}

// Estado final de una linea: ya se guardo una decision para ella (via
// "Guardar decision"), no queda nada mas por resolver -la fila pasa a
// mostrar un boton "Ver" de solo lectura en vez de Editar/Aprobar/Cancelar.
function isTerminalLineStatus(status: string): boolean {
  return status === "APPROVED" || status === "REJECTED";
}

// Borrador de linea en el detalle: la decision (Aprobar/Cancelar) y la
// cantidad editada quedan solo en memoria hasta "Guardar decision" -recien
// ahi se manda el PUT a purchase-request-lines/:id (ver handleSaveDecisions).
interface LineDraft {
  lineId: number;
  productId: string;
  productName: string;
  equipmentType: string | null;
  currentStatus: string;
  originalQuantity: number;
  quantity: number;
  editing: boolean;
  decision: "APPROVED" | "REJECTED" | null;
}

export default function AproveRequest() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [search, setSearch] = useState("");

  const [selectedRequest, setSelectedRequest] = useState<PurchaseRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);
  const [savingDecisions, setSavingDecisions] = useState(false);
  const [rejectingRequest, setRejectingRequest] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        // Solo lo que todavia esta esperando una decision de cabecera: una
        // vez APPROVED, la solicitud sigue su camino (cotizacion, etc.) y ya
        // no le corresponde a esta cola -ver requestQuotation/
        // requestQuoteApproval en purchaseRequest.service.ts.
        const res = await purchaseRequestService.listMyApprovals({
          status: "DRAFT,SUBMITTED",
          limit: 100,
          search: search.trim() || undefined,
        });
        if (cancelled) return;
        setRequests(res.items);
      } catch (error) {
        handleError(error, navigate);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, search]);

  function buildDrafts(lines: PurchaseRequestLine[], productNames: Map<string, string>): LineDraft[] {
    // Atajo: si la solicitud tiene un solo producto y todavia no fue
    // decidido, se pre-marca "Aprobar" -sigue haciendo falta "Guardar
    // decision" para persistirlo, no se auto-guarda solo.
    const singleUndecidedLine = lines.length === 1 && !isTerminalLineStatus(lines[0].status);

    return lines.map((line) => ({
      lineId: line.id,
      productId: line.productId,
      productName: productNames.get(line.productId) ?? line.productId,
      equipmentType: line.equipmentType,
      currentStatus: line.status,
      originalQuantity: line.quantity,
      quantity: line.quantity,
      editing: false,
      decision: singleUndecidedLine ? "APPROVED" : null,
    }));
  }

  async function loadLineDrafts(requestId: number): Promise<void> {
    setDetailLoading(true);
    try {
      const linesRes = await purchaseRequestLineService.list(requestId, { limit: 1000 });
      const products = await Promise.all(
        [...new Set(linesRes.items.map((line) => line.productId))].map((productId) =>
          productService.getById(productId),
        ),
      );
      const productNames = new Map(products.map((product) => [product.id, product.name]));
      setLineDrafts(buildDrafts(linesRes.items, productNames));
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleViewRequest(request: PurchaseRequest): Promise<void> {
    setSelectedRequest(request);
    await loadLineDrafts(request.id);
  }

  function handleBackToList(): void {
    setSelectedRequest(null);
    setLineDrafts([]);
  }

  function toggleEditing(lineId: number): void {
    setLineDrafts((prev) =>
      prev.map((draft) => (draft.lineId === lineId ? { ...draft, editing: !draft.editing } : draft)),
    );
  }

  function setQuantity(lineId: number, value: number): void {
    setLineDrafts((prev) => prev.map((draft) => (draft.lineId === lineId ? { ...draft, quantity: value } : draft)));
  }

  // Click en Aprobar/Cancelar sobre la MISMA decision ya marcada la
  // destaca (permite arrepentirse antes de guardar).
  function setDecision(lineId: number, decision: "APPROVED" | "REJECTED"): void {
    setLineDrafts((prev) =>
      prev.map((draft) =>
        draft.lineId === lineId ? { ...draft, decision: draft.decision === decision ? null : decision } : draft,
      ),
    );
  }

  async function handleSaveDecisions(): Promise<void> {
    if (!selectedRequest) return;
    const pending = lineDrafts.filter((draft) => draft.decision !== null);
    if (pending.length === 0) return;

    for (const draft of pending) {
      if (!Number.isInteger(draft.quantity) || draft.quantity <= 0) {
        showErrorToast(`La cantidad de "${draft.productName}" debe ser un numero entero mayor a cero`);
        return;
      }
    }

    setSavingDecisions(true);
    try {
      let anyApproved = false;
      for (const draft of pending) {
        await purchaseRequestLineService.update(draft.lineId, {
          status: draft.decision as "APPROVED" | "REJECTED",
          ...(draft.quantity !== draft.originalQuantity ? { quantity: draft.quantity } : {}),
        });
        if (draft.decision === "APPROVED") anyApproved = true;
        // Se saca del set "pendiente de guardar" apenas se confirma: si algo
        // mas adelante falla, un reintento no vuelve a mandar esta linea.
        setLineDrafts((prev) =>
          prev.map((item) => (item.lineId === draft.lineId ? { ...item, decision: null } : item)),
        );
      }

      if (anyApproved && selectedRequest.status !== "APPROVED") {
        await purchaseRequestService.updateStatus(selectedRequest.id, "APPROVED");
        setSelectedRequest((prev) => (prev ? { ...prev, status: "APPROVED" as PurchaseRequestStatus } : prev));
        setRequests((prev) =>
          prev.map((item) => (item.id === selectedRequest.id ? { ...item, status: "APPROVED" } : item)),
        );
      }

      showSuccessToast("Decision guardada exitosamente");
      await loadLineDrafts(selectedRequest.id);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSavingDecisions(false);
    }
  }

  // Rechazo de la CABECERA (distinto de rechazar una linea puntual, ver
  // setDecision): solo tiene sentido mientras la solicitud sigue esperando
  // esta decision -DRAFT/SUBMITTED, mismas transiciones que
  // PURCHASE_REQUEST_TRANSITIONS en el backend-.
  async function handleRejectRequest(): Promise<void> {
    if (!selectedRequest) return;
    setRejectingRequest(true);
    try {
      await purchaseRequestService.updateStatus(selectedRequest.id, "REJECTED");
      showSuccessToast(`Solicitud ${selectedRequest.requestNumber} rechazada`);
      handleBackToList();
      setRequests((prev) => prev.filter((item) => item.id !== selectedRequest.id));
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setRejectingRequest(false);
    }
  }

  if (selectedRequest) {
    const hasPendingDecisions = lineDrafts.some((draft) => draft.decision !== null);
    const canRejectRequest = selectedRequest.status === "DRAFT" || selectedRequest.status === "SUBMITTED";

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
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(selectedRequest.status)}`}>
                    {selectedRequest.status}
                  </span>
                  {canRejectRequest && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="bg-red-600 text-white hover:bg-red-700 border-red-600"
                      loading={rejectingRequest}
                      onClick={() => void handleRejectRequest()}
                    >
                      Rechazar Solicitud
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-600 min-[800px]:grid-cols-3">
                <p>
                  <span className="font-semibold text-slate-700">Solicitante:</span> {selectedRequest.requester.firstName}{" "}
                  {selectedRequest.requester.lastName}
                </p>
                <p>
                  <span className="font-semibold text-slate-700">Beneficiario:</span> {selectedRequest.beneficiary.firstName}{" "}
                  {selectedRequest.beneficiary.lastName}
                </p>
                <p>
                  <span className="font-semibold text-slate-700">Prioridad:</span> {selectedRequest.priority}
                </p>
                <p className="break-words min-[800px]:col-span-3">

                  <span className="font-semibold text-slate-700">Notas:</span> {selectedRequest.notes ?? "-"}
                </p>
              </div>
            </div>

            {detailLoading ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : lineDrafts.length === 0 ? (
              <EmptyState title="Sin productos" description="Esta solicitud no tiene productos asociados." />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="min-w-[10rem] px-4 py-2 text-left font-semibold text-slate-600">Producto</th>
                      <th className="min-w-[9rem] px-4 py-2 text-left font-semibold text-slate-600">Tipo de Equipamiento</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Cantidad</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Estado</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lineDrafts.map((draft) => (
                      <tr key={draft.lineId}>
                        <td className="px-4 py-2 font-medium text-slate-900">{draft.productName}</td>
                        <td className="px-4 py-2 text-slate-600">{draft.equipmentType ?? "-"}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {draft.editing ? (
                            <Input
                              type="number"
                              min={1}
                              value={draft.quantity}
                              onChange={(e) => setQuantity(draft.lineId, Number(e.target.value))}
                              className="w-24 bg-zinc-100 focus:bg-indigo-100"
                            />
                          ) : (
                            draft.quantity
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              draft.decision
                                ? statusBadgeClass(draft.decision)
                                : statusBadgeClass(draft.currentStatus)
                            }`}
                          >
                            {draft.decision
                              ? `${draft.decision} (sin guardar)`
                              : draft.currentStatus}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">
                          {isTerminalLineStatus(draft.currentStatus) ? (
                            <Button type="button" variant="secondary" disabled>
                              Ver
                            </Button>
                          ) : (
                            <div className="flex gap-2">
                              <Button type="button" variant="secondary" onClick={() => toggleEditing(draft.lineId)}>
                                {draft.editing ? "Listo" : "Editar"}
                              </Button>
                              <Button
                                type="button"
                                variant={draft.decision === "APPROVED" ? "success" : "secondary"}
                                onClick={() => setDecision(draft.lineId, "APPROVED")}
                              >
                                Aprobar
                              </Button>
                              <button
                                type="button"
                                onClick={() => setDecision(draft.lineId, "REJECTED")}
                                className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                                  draft.decision === "REJECTED"
                                    ? "bg-red-600 text-white hover:bg-red-700"
                                    : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
                                }`}
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-center mt-6">
              <Button
                type="button"
                loading={savingDecisions}
                disabled={!hasPendingDecisions}
                onClick={() => void handleSaveDecisions()}
                className="w-full sm:w-60"
              >
                Guardar decision
              </Button>
            </div>
          </div>
        </div>
      </RequirePermissions>
    );
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          Solicitudes por Aprobar
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
              description="No tenes solicitudes asignadas para aprobar con ese criterio."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">N° Solicitud</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Solicitante</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Beneficiario</th>
                    <th className="min-w-[12rem] px-4 py-2 text-left font-semibold text-slate-600">Notas</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Prioridad</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Estado</th>
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
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {request.beneficiary.firstName} {request.beneficiary.lastName}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{request.notes ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{request.priority}</td>
                      <td className="whitespace-nowrap px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(request.status)}`}>
                          {request.status}
                        </span>
                      </td>
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
