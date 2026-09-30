import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Field, Select, Button, Input, EmptyState } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { useNotifications } from "../../notifications/useNotifications";
import { productService, purchaseOrderService, purchaseRequestService, quoteService, supplierService } from "../../services";
import type { PurchaseOrder, PurchaseRequest, Quote, Supplier } from "../../types";


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
  // Una OC puede cubrir varios productos -las ganadoras del mismo proveedor.
  productNames: string[];
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
  // Cotizaciones ganadoras (SELECTED) que TODAVIA no quedaron cubiertas por
  // ninguna orden de compra -ver areAllWinningQuotesOrdered en
  // purchaseOrder.service.ts: una solicitud con varias lineas aprobadas
  // puede tener varias, y varias de esas pueden terminar en UNA sola OC si
  // comparten proveedor.
  const [pendingQuotes, setPendingQuotes] = useState<Quote[]>([]);
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orderRows, setOrderRows] = useState<OrderRow[]>([]);

  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [selectedQuoteIds, setSelectedQuoteIds] = useState<Set<number>>(new Set());
  const [paymentTerms, setPaymentTerms] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  // Id de la OC ya creada en un intento previo que fallo SOLO al subir el
  // PDF (mismo criterio que CreateProducts.tsx) -un reintento no vuelve a
  // crear la orden, que chocaria con el guard "alguna cotizacion ya quedo
  // cubierta" en createPurchaseOrder.
  const [pendingOrderId, setPendingOrderId] = useState<number | null>(null);

  // Adjuntar el PDF de una OC que ya se emitio antes (create tuvo exito,
  // uploadAttachment fallo o nunca se intento) sin volver a crear la orden
  // -sin esto, si el usuario navegaba fuera del panel de emision (que
  // desaparece apenas pendingQuotes queda vacio), esa OC quedaba sin PDF
  // para siempre y la solicitud nunca llegaba a OC_GENERATED.
  const [attachFiles, setAttachFiles] = useState<Map<number, File>>(new Map());
  const [attachingOrderId, setAttachingOrderId] = useState<number | null>(null);

  // Agrupado client-side -Quote.supplierId ya viene en el payload, sin fetch
  // extra. Una OC nunca puede cruzar dos proveedores (restriccion real del
  // negocio, validada tambien server-side en createPurchaseOrder).
  const quotesBySupplier = useMemo(() => {
    const map = new Map<number, Quote[]>();
    for (const quote of pendingQuotes) {
      map.set(quote.supplierId, [...(map.get(quote.supplierId) ?? []), quote]);
    }
    return map;
  }, [pendingQuotes]);

  const supplierQuotes = selectedSupplierId ? (quotesBySupplier.get(Number(selectedSupplierId)) ?? []) : [];

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
      const orderedQuoteIds = new Set(ordersRes.items.flatMap((order) => order.quotes?.map((quote) => quote.id) ?? []));

      const products = await Promise.all(
        [...new Set(winningQuotes.map((quote) => quote.productId))].map((productId) => productService.getById(productId)),
      );
      const names = new Map(products.map((product) => [product.id, product.name]));

      const rows = await Promise.all(
        ordersRes.items.map(async (order): Promise<OrderRow> => {
          const { files } = await purchaseOrderService.listDocuments(order.id);
          return {
            order,
            productNames: (order.quotes ?? []).map((quote) => names.get(quote.productId) ?? quote.productId),
            attached: files.some((filename) => filename.startsWith(`OC-${order.orderNumber}`)),
          };
        }),
      );

      const pending = winningQuotes.filter((quote) => !orderedQuoteIds.has(quote.id));
      setPendingQuotes(pending);
      setProductNames(names);
      setSuppliers(suppliersRes.items);
      setOrderRows(rows);

      // Con un solo proveedor pendiente (el caso normal) se preselecciona
      // todo: el flujo de 1 click no se degrada por soportar el caso de
      // varios proveedores en la misma solicitud.
      const supplierIds = [...new Set(pending.map((quote) => quote.supplierId))];
      const initialSupplierId = supplierIds.length === 1 ? String(supplierIds[0]) : "";
      setSelectedSupplierId(initialSupplierId);
      setSelectedQuoteIds(
        new Set(initialSupplierId ? pending.filter((quote) => String(quote.supplierId) === initialSupplierId).map((quote) => quote.id) : []),
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

  function supplierName(supplierId: number): string {
    return suppliers.find((supplier) => supplier.id === supplierId)?.businessPartner.legalName ?? `Proveedor ${supplierId}`;
  }

  function handleSupplierChange(value: string): void {
    setSelectedSupplierId(value);
    const quotes = value ? (quotesBySupplier.get(Number(value)) ?? []) : [];
    setSelectedQuoteIds(new Set(quotes.map((quote) => quote.id)));
  }

  function toggleQuote(quoteId: number): void {
    setSelectedQuoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(quoteId)) next.delete(quoteId);
      else next.add(quoteId);
      return next;
    });
  }

  function resetFormFields(): void {
    setSelectedSupplierId("");
    setSelectedQuoteIds(new Set());
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
    setAttachFiles(new Map());
    resetFormFields();
  }

  function validate(): void {
    if (!pendingOrderId && selectedQuoteIds.size === 0) throw createValidationError("Debe seleccionar al menos una cotización ganadora");
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
          quoteIds: [...selectedQuoteIds],
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

  // Adjunta el PDF de una OC que quedo emitida sin adjuntar (ver comentario
  // de attachFiles arriba) -no crea una orden nueva, solo sube el archivo.
  async function handleAttachExisting(orderId: number): Promise<void> {
    const pendingFile = attachFiles.get(orderId);
    if (!pendingFile || !selectedRequest) return;
    setAttachingOrderId(orderId);
    try {
      await purchaseOrderService.uploadAttachment(orderId, pendingFile);
      showSuccessToast("PDF de la orden de compra adjuntado exitosamente");
      setAttachFiles((prev) => {
        const next = new Map(prev);
        next.delete(orderId);
        return next;
      });
      void refreshNotifications();

      const refreshed = await purchaseRequestService.getById(selectedRequest.id);
      if (refreshed.status !== "QUOTE_APPROVED") {
        setRequests((prev) => prev.filter((item) => item.id !== refreshed.id));
        handleBackToList();
        return;
      }
      setSelectedRequest(refreshed);
      await loadDetail(selectedRequest.id);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setAttachingOrderId(null);
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
                  <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
                    <h2 className="mb-3 text-sm font-semibold text-slate-600">Emitir Orden de Compra</h2>
                    <div className="grid grid-cols-1 max-[799px]:grid-cols-1 min-[800px]:grid-cols-6 min-[1000px]:grid-cols-8 min-[1200px]:grid-cols-10 min-[1400px]:grid-cols-12 gap-4">
                      <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-4 min-[1200px]:col-span-4 min-[1400px]:col-span-5">
                        <Field label="Proveedor" htmlFor="selectedSupplierId">
                          <Select
                            id="selectedSupplierId"
                            className="bg-zinc-100 focus:bg-indigo-100"
                            value={selectedSupplierId}
                            onChange={(e) => handleSupplierChange(e.target.value)}
                            disabled={pendingOrderId !== null}
                          >
                            <option value="">Seleccione el proveedor</option>
                            {[...quotesBySupplier.keys()].map((supplierId) => (
                              <option key={supplierId} value={supplierId}>
                                {supplierName(supplierId)} ({quotesBySupplier.get(supplierId)?.length} cotización(es))
                              </option>
                            ))}
                          </Select>
                        </Field>
                        {supplierQuotes.length > 0 && (
                          <div className="mt-2 rounded-md border border-slate-200 p-2">
                            <label className="flex items-center gap-2 border-b border-slate-100 pb-1 text-xs font-semibold text-slate-600">
                              <input
                                type="checkbox"
                                checked={selectedQuoteIds.size === supplierQuotes.length}
                                disabled={pendingOrderId !== null}
                                onChange={(e) =>
                                  setSelectedQuoteIds(e.target.checked ? new Set(supplierQuotes.map((quote) => quote.id)) : new Set())
                                }
                              />
                              Cotizaciones a incluir en esta OC
                            </label>
                            {supplierQuotes.map((quote) => (
                              <label key={quote.id} className="flex items-start gap-2 py-1 text-sm text-slate-700 break-words">

                                <input
                                  type="checkbox"
                                  checked={selectedQuoteIds.has(quote.id)}
                                  disabled={pendingOrderId !== null}
                                  onChange={() => toggleQuote(quote.id)}
                                />
                                {productNames.get(quote.productId) ?? quote.productId} — {quote.purchaseValue}
                              </label>
                            ))}
                          </div>
                        )}
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
                        className="w-full sm:w-60"
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
                            <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">N° Orden</th>
                            <th className="min-w-[10rem] px-4 py-2 text-left font-semibold text-slate-600">Producto(s)</th>
                            <th className="min-w-[10rem] px-4 py-2 text-left font-semibold text-slate-600">Proveedor</th>
                            <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {orderRows.map((row) => (
                            <tr key={row.order.id}>
                              <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">{row.order.orderNumber}</td>
                              <td className="px-4 py-2 text-slate-600">{row.productNames.join(", ") || "-"}</td>
                              <td className="px-4 py-2 text-slate-600">{supplierName(row.order.supplierId)}</td>
                              <td className="whitespace-nowrap px-4 py-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                      row.attached ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                                    }`}
                                  >
                                    {row.attached ? "PDF adjuntado" : "Falta adjuntar PDF"}
                                  </span>
                                  {!row.attached && (
                                    <>
                                      <input
                                        type="file"
                                        accept="application/pdf,image/jpeg,image/png"
                                        className="max-w-40 text-xs"
                                        onChange={(e) => {
                                          const chosen = e.target.files?.[0] ?? null;
                                          setAttachFiles((prev) => {
                                            const next = new Map(prev);
                                            if (chosen) next.set(row.order.id, chosen);
                                            else next.delete(row.order.id);
                                            return next;
                                          });
                                        }}
                                      />
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        loading={attachingOrderId === row.order.id}
                                        disabled={!attachFiles.has(row.order.id)}
                                        onClick={() => void handleAttachExisting(row.order.id)}
                                      >
                                        Adjuntar
                                      </Button>
                                    </>
                                  )}
                                </div>
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
      <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          Adjuntar Orden de Compra
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
            <EmptyState title="Sin solicitudes" description="No tenés solicitudes con cotización aprobada pendientes de OC." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">N° Solicitud</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">Solicitante</th>
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
