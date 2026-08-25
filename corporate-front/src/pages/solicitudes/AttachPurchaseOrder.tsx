import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Field, Select, Button, Input, EmptyState } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { useNotifications } from "../../notifications/useNotifications";
import { productService, purchaseOrderService, purchaseRequestService, quoteService, supplierService } from "../../services";
import type { PurchaseOrder, PurchaseRequest, Quote, Supplier } from "../../types";

// Paso 6 del flujo: el SOLICITANTE (no el aprobador ni un analista) emite y
// adjunta la OC de cada cotizacion ganadora -purchase-requests:create es el
// permiso que ya exige GET /purchase-requests/my-requests.
const REQUIRED_PERMISSIONS = [
  "purchase-requests:create",
  // Ademas de "create" (que ya gatea /my-requests): handleIssueOrder relee
  // la solicitud via GET /purchase-requests/:id despues de emitir la OC, y
  // esa ruta exige "read" -sin este permiso el refresh posterior a un exito
  // real 403ea (la OC ya quedo emitida/adjuntada, solo falla el refetch).
  "purchase-requests:read",
  "quotes:read",
  "purchase-orders:read",
  "purchase-orders:create",
  "purchase-orders:update",
  "products:read",
  "suppliers:read",
] as const;

interface OrderRow {
  order: PurchaseOrder;
  productName: string;
  attached: boolean;
}

export default function AttachPurchaseOrder() {
  const navigate = useNavigate();
  const { refresh: refreshNotifications } = useNotifications();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [search, setSearch] = useState("");

  const [selectedRequest, setSelectedRequest] = useState<PurchaseRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Cotizaciones ganadoras (SELECTED) que TODAVIA no tienen una orden de
  // compra -ver areAllWinningQuotesOrdered en purchaseOrder.service.ts: una
  // solicitud con varias lineas aprobadas puede tener varias.
  const [pendingQuotes, setPendingQuotes] = useState<Quote[]>([]);
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orderRows, setOrderRows] = useState<OrderRow[]>([]);

  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  // Id de la OC ya creada en un intento previo que fallo SOLO al subir el
  // PDF (mismo criterio que CreateProducts.tsx) -un reintento no vuelve a
  // crear la orden, que chocaria con el guard "ya existe una OC para esta
  // cotizacion" en createPurchaseOrder.
  const [pendingOrderId, setPendingOrderId] = useState<number | null>(null);

  async function loadList(): Promise<void> {
    setLoading(true);
    try {
      const res = await purchaseRequestService.listMyRequests({
        status: "QUOTE_APPROVED",
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
      const [quotesRes, ordersRes, suppliersRes] = await Promise.all([
        quoteService.list(requestId, { limit: 1000 }),
        purchaseOrderService.list({ requestId, limit: 1000 }),
        supplierService.list({ limit: 1000 }),
      ]);
      const winningQuotes = quotesRes.items.filter((quote) => quote.status === "SELECTED");
      const orderedQuoteIds = new Set(ordersRes.items.map((order) => order.quoteId));

      const products = await Promise.all(
        [...new Set(winningQuotes.map((quote) => quote.productId))].map((productId) => productService.getById(productId)),
      );
      const names = new Map(products.map((product) => [product.id, product.name]));

      const rows = await Promise.all(
        ordersRes.items.map(async (order): Promise<OrderRow> => {
          const { files } = await purchaseOrderService.listDocuments(order.id);
          return {
            order,
            productName: order.quote ? (names.get(order.quote.productId) ?? order.quote.productId) : String(order.quoteId),
            attached: files.some((filename) => filename.startsWith(`OC-${order.orderNumber}`)),
          };
        }),
      );

      setPendingQuotes(winningQuotes.filter((quote) => !orderedQuoteIds.has(quote.id)));
      setProductNames(names);
      setSuppliers(suppliersRes.items);
      setOrderRows(rows);
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

  function supplierName(supplierId: number): string {
    return suppliers.find((supplier) => supplier.id === supplierId)?.businessPartner.legalName ?? `Proveedor ${supplierId}`;
  }

  function resetFormFields(): void {
    setSelectedQuoteId("");
    setPaymentTerms("");
    setFile(null);
    setPendingOrderId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleBackToList(): void {
    setSelectedRequest(null);
    setPendingQuotes([]);
    setProductNames(new Map());
    setSuppliers([]);
    setOrderRows([]);
    resetFormFields();
  }

  function validate(): void {
    if (!pendingOrderId && !selectedQuoteId) throw createValidationError("Debe seleccionar la cotización ganadora");
    if (!file) throw createValidationError("Debe adjuntar el PDF de la orden de compra");
  }

  async function handleIssueOrder(): Promise<void> {
    if (!selectedRequest) return;
    setSubmitting(true);
    try {
      validate();

      let orderId = pendingOrderId;
      if (!orderId) {
        const order = await purchaseOrderService.create({
          quoteId: Number(selectedQuoteId),
          paymentTerms: paymentTerms.trim() || undefined,
        });
        orderId = order.id;
        setPendingOrderId(orderId);
      }
      await purchaseOrderService.uploadAttachment(orderId, file as File);

      showSuccessToast("Orden de compra emitida y adjuntada exitosamente");
      resetFormFields();

      // El badge de "pendiente de OC" es un conteo derivado, no un push -acá
      // nadie más lo dispara (el backend solo emite notify en los 3 puntos
      // de la Fase B), así que el propio actor que resolvió su pendiente
      // tiene que refrescarlo el mismo.
      void refreshNotifications();

      // Si esta era la ultima cotizacion ganadora pendiente, el backend ya
      // flipeo la solicitud a OC_GENERATED (ver areAllWinningQuotesOrdered)
      // -deja de pertenecer a esta cola.
      const refreshed = await purchaseRequestService.getById(selectedRequest.id);
      if (refreshed.status !== "QUOTE_APPROVED") {
        showSuccessToast(`Solicitud ${refreshed.requestNumber}: todas las órdenes de compra ya fueron emitidas`);
        setRequests((prev) => prev.filter((item) => item.id !== refreshed.id));
        handleBackToList();
        return;
      }
      setSelectedRequest(refreshed);
      await loadDetail(selectedRequest.id);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSubmitting(false);
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
              <h1 className="text-xl font-bold text-gray-600">Solicitud {selectedRequest.requestNumber}</h1>
              <p className="mt-1 text-sm text-slate-600">
                <span className="font-semibold text-slate-700">Solicitante:</span> {selectedRequest.requester.firstName}{" "}
                {selectedRequest.requester.lastName}
              </p>
            </div>

            {detailLoading ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : (
              <>
                {pendingQuotes.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <h2 className="mb-3 text-sm font-semibold text-slate-600">Emitir Orden de Compra</h2>
                    <div className="grid grid-cols-1 max-[799px]:grid-cols-1 min-[800px]:grid-cols-6 min-[1000px]:grid-cols-8 min-[1200px]:grid-cols-10 min-[1400px]:grid-cols-12 gap-4">
                      <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-4 min-[1200px]:col-span-4 min-[1400px]:col-span-5">
                        <Field label="Cotización ganadora" htmlFor="selectedQuoteId">
                          <Select
                            id="selectedQuoteId"
                            className="bg-zinc-100 focus:bg-indigo-100"
                            value={selectedQuoteId}
                            onChange={(e) => setSelectedQuoteId(e.target.value)}
                            disabled={pendingOrderId !== null}
                          >
                            <option value="">Seleccione la cotización</option>
                            {pendingQuotes.map((quote) => (
                              <option key={quote.id} value={quote.id}>
                                {productNames.get(quote.productId) ?? quote.productId} — {supplierName(quote.supplierId)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-3">
                        <Field label="Condiciones de pago (opcional)" htmlFor="paymentTerms">
                          <Input
                            id="paymentTerms"
                            value={paymentTerms}
                            onChange={(e) => setPaymentTerms(e.target.value)}
                            className="bg-zinc-100 focus:bg-indigo-100"
                          />
                        </Field>
                      </div>
                      <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
                        <Field label="PDF de la orden de compra" htmlFor="orderFile">
                          <Input
                            ref={fileInputRef}
                            id="orderFile"
                            type="file"
                            accept="application/pdf,image/jpeg,image/png"
                            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                            className="bg-zinc-100 focus:bg-indigo-100"
                          />
                        </Field>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-center">
                      <Button
                        type="button"
                        variant="success"
                        loading={submitting}
                        onClick={() => void handleIssueOrder()}
                        className="w-60"
                      >
                        Emitir y Adjuntar
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mt-6">
                  <h2 className="mb-3 text-sm font-semibold text-slate-600">Órdenes de compra emitidas</h2>
                  {orderRows.length === 0 ? (
                    <EmptyState title="Sin órdenes" description="Todavía no se emitió ninguna orden de compra." />
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-2 text-left font-semibold text-slate-600">N° Orden</th>
                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Producto</th>
                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Proveedor</th>
                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {orderRows.map((row) => (
                            <tr key={row.order.id}>
                              <td className="px-4 py-2 font-medium text-slate-900">{row.order.orderNumber}</td>
                              <td className="px-4 py-2 text-slate-600">{row.productName}</td>
                              <td className="px-4 py-2 text-slate-600">{supplierName(row.order.supplierId)}</td>
                              <td className="px-4 py-2">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                    row.attached ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                                  }`}
                                >
                                  {row.attached ? "PDF adjuntado" : "Falta adjuntar PDF"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
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
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          Adjuntar Orden de Compra
        </h1>

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
            <EmptyState title="Sin solicitudes" description="No tenés solicitudes con cotización aprobada pendientes de OC." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">N° Solicitud</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Solicitante</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Prioridad</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="px-4 py-2 font-medium text-slate-900">{request.requestNumber}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {request.requester.firstName} {request.requester.lastName}
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
