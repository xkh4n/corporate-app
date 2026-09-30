import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Input, Button, EmptyState } from "../../components/ui";
import { showSuccessToast, showErrorToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import {
  authorizationService,
  productService,
  purchaseRequestLineService,
  purchaseRequestService,
  quoteService,
  supplierService,
} from "../../services";
import type { PurchaseRequest, PurchaseRequestLine, Quote, Supplier } from "../../types";

// Paso 5 del flujo: elegir, por cada linea APPROVED, cual cotizacion
// competidora gano -restringido al approverId asignado a la solicitud (el
// backend lo re-verifica igual, esto solo evita que la pantalla se le
// ofrezca a quien no puede usarla). authorizations:create es el permiso que
// el endpoint realmente exige (ver plan de implementacion, seccion B.3):
// quotes:approve queda reservado/sin usar a proposito.
const REQUIRED_PERMISSIONS = [
  "purchase-requests:approve",
  // Ademas de "approve" (que ya gatea /my-approvals): handleAuthorizeLine
  // relee la solicitud via GET /purchase-requests/:id despues de autorizar,
  // y esa ruta exige "read" -sin este permiso el refresh posterior a un
  // exito real 403ea (la autorizacion ya quedo creada, solo falla el
  // refetch).
  "purchase-requests:read",
  "purchase-request-lines:read",
  "quotes:read",
  "authorizations:create",
  // loadDetail resuelve el nombre del proveedor de cada cotizacion
  // competidora via GET /suppliers (supplierService.list) -sin este permiso
  // el detalle entero de la solicitud falla al abrir "Ver".
  "suppliers:read",
] as const;

interface LineDetail {
  line: PurchaseRequestLine;
  productName: string;
  quotes: Quote[];
  winner: Quote | null;
  selectedQuoteId: number | null;
  approvedQuantity: number;
  authorizing: boolean;
}

export default function ApproveQuote() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [search, setSearch] = useState("");

  const [selectedRequest, setSelectedRequest] = useState<PurchaseRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lineDetails, setLineDetails] = useState<LineDetail[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await purchaseRequestService.listMyApprovals({
          status: "APPROVE_QUOTE",
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

  function supplierName(supplierId: number): string {
    return suppliers.find((supplier) => supplier.id === supplierId)?.businessPartner.legalName ?? `Proveedor ${supplierId}`;
  }

  async function loadDetail(requestId: number): Promise<void> {
    setDetailLoading(true);
    try {
      const [linesRes, suppliersRes] = await Promise.all([
        purchaseRequestLineService.list(requestId, { limit: 1000 }),
        supplierService.list({ limit: 1000 }),
      ]);
      setSuppliers(suppliersRes.items);

      // Solo lineas ya APPROVED (paso 2): son las unicas con cotizaciones
      // competidoras validas para elegir ganadora.
      const approvedLines = linesRes.items.filter((line) => line.status === "APPROVED");

      const [products, quotesRes] = await Promise.all([
        Promise.all(
          [...new Set(approvedLines.map((line) => line.productId))].map((productId) => productService.getById(productId)),
        ),
        quoteService.list(requestId, { limit: 1000 }),
      ]);
      const productNames = new Map(products.map((product) => [product.id, product.name]));

      const details: LineDetail[] = approvedLines.map((line) => {
        const quotesForLine = quotesRes.items.filter((quote) => quote.productId === line.productId);
        const winner = quotesForLine.find((quote) => quote.status === "SELECTED") ?? null;
        const pending = quotesForLine.filter((quote) => quote.status === "PENDING");
        return {
          line,
          productName: productNames.get(line.productId) ?? line.productId,
          quotes: winner ? quotesForLine : pending,
          winner,
          selectedQuoteId: null,
          approvedQuantity: line.quantity,
          authorizing: false,
        };
      });
      setLineDetails(details);
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
    setLineDetails([]);
  }

  function setSelectedQuote(lineId: number, quoteId: number): void {
    setLineDetails((prev) =>
      prev.map((detail) => (detail.line.id === lineId ? { ...detail, selectedQuoteId: quoteId } : detail)),
    );
  }

  function setApprovedQuantity(lineId: number, value: number): void {
    setLineDetails((prev) =>
      prev.map((detail) => (detail.line.id === lineId ? { ...detail, approvedQuantity: value } : detail)),
    );
  }

  async function handleAuthorizeLine(detail: LineDetail): Promise<void> {
    if (!selectedRequest || !detail.selectedQuoteId) return;
    if (!Number.isInteger(detail.approvedQuantity) || detail.approvedQuantity <= 0) {
      showErrorToast(`La cantidad aprobada para "${detail.productName}" debe ser mayor a cero`);
      return;
    }

    setLineDetails((prev) =>
      prev.map((item) => (item.line.id === detail.line.id ? { ...item, authorizing: true } : item)),
    );
    try {
      await authorizationService.create({
        requestLineId: detail.line.id,
        quoteId: detail.selectedQuoteId,
        approvedQuantity: detail.approvedQuantity,
      });
      showSuccessToast(`Cotización autorizada para "${detail.productName}"`);

      // El backend puede haber flipeado la solicitud a QUOTE_APPROVED (si
      // esta era la ultima linea pendiente, ver areAllApprovedLinesAuthorized
      // en purchaseRequestLine.service.ts) -se releen ambos para reflejarlo.
      const updatedRequest = await purchaseRequestService.getById(selectedRequest.id);
      if (updatedRequest.status !== "APPROVE_QUOTE") {
        showSuccessToast(`Solicitud ${updatedRequest.requestNumber}: todas las líneas ya tienen ganador`);
        setRequests((prev) => prev.filter((item) => item.id !== updatedRequest.id));
        handleBackToList();
        return;
      }
      setSelectedRequest(updatedRequest);
      await loadDetail(selectedRequest.id);
    } catch (error) {
      handleError(error, navigate);
      setLineDetails((prev) =>
        prev.map((item) => (item.line.id === detail.line.id ? { ...item, authorizing: false } : item)),
      );
    }
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
              <h1 className="text-xl font-bold text-gray-600">Solicitud {selectedRequest.requestNumber}</h1>
              <p className="mt-1 text-sm text-slate-600">
                Solicitante: {selectedRequest.requester.firstName} {selectedRequest.requester.lastName}
              </p>
            </div>

            {detailLoading ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : lineDetails.length === 0 ? (
              <EmptyState
                title="Sin líneas por autorizar"
                description="Esta solicitud no tiene líneas aprobadas pendientes de elegir ganadora."
              />
            ) : (
              <div className="space-y-4">
                {lineDetails.map((detail) => (
                  <div key={detail.line.id} className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-semibold text-slate-800">
                        {detail.productName} <span className="text-slate-500 font-normal">(cant. {detail.line.quantity})</span>
                      </h2>
                      {detail.winner && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Ya autorizada
                        </span>
                      )}
                    </div>

                    {detail.quotes.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">Sin cotizaciones cargadas para este producto.</p>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold text-slate-600"></th>
                              <th className="min-w-[10rem] px-3 py-2 text-left font-semibold text-slate-600">Proveedor</th>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-600">Modelo</th>
                              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-600">Valor</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {detail.quotes.map((quote) => (
                              <tr key={quote.id} className={quote.status === "SELECTED" ? "bg-emerald-50" : undefined}>
                                <td className="px-3 py-2">
                                  {!detail.winner && (
                                    <input
                                      type="radio"
                                      name={`quote-line-${detail.line.id}`}
                                      checked={detail.selectedQuoteId === quote.id}
                                      onChange={() => setSelectedQuote(detail.line.id, quote.id)}
                                    />
                                  )}
                                  {quote.status === "SELECTED" && <span className="text-emerald-600">✓</span>}
                                </td>
                                <td className="px-3 py-2 text-slate-700">{supplierName(quote.supplierId)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{quote.model ?? "-"}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-slate-600">${quote.purchaseValue}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {!detail.winner && detail.quotes.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-end gap-3">
                        <div className="w-40">
                          <label className="mb-1 block text-xs font-medium text-slate-600">Cantidad aprobada</label>
                          <Input
                            type="number"
                            min={1}
                            max={detail.line.quantity}
                            value={detail.approvedQuantity}
                            onChange={(e) => setApprovedQuantity(detail.line.id, Number(e.target.value))}
                            className="bg-zinc-100 focus:bg-indigo-100"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="success"
                          disabled={!detail.selectedQuoteId}
                          loading={detail.authorizing}
                          onClick={() => void handleAuthorizeLine(detail)}
                        >
                          Autorizar línea
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
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
          Cotizaciones por Autorizar
        </h1>

        <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8">
          <div className="mb-4 max-w-sm">
            <Input
              placeholder="Buscar por número, notas o prioridad..."
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
            <EmptyState title="Sin pendientes" description="No tenés cotizaciones asignadas para autorizar con ese criterio." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">N° Solicitud</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Solicitante</th>
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
                        {request.requester.firstName} {request.requester.lastName}
                      </td>
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
