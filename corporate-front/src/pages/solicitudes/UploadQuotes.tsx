import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Field, Select, Button, Input, EmptyState } from "../../components/ui";
import { showSuccessToast, showErrorToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import {
  productService,
  purchaseRequestLineService,
  purchaseRequestService,
  quoteService,
  supplierService,
} from "../../services";
import type { PurchaseRequest, PurchaseRequestLine, Quote, Supplier } from "../../types";

// purchase-request-lines:read para restringir el producto a los de la
// solicitud, quotes:read/quotes:create para el detalle y el alta,
// suppliers:read/products:read para poblar los selects.
const REQUIRED_PERMISSIONS = [
  "purchase-requests:read",
  "purchase-request-lines:read",
  "quotes:read",
  "quotes:create",
  "suppliers:read",
  "products:read",
] as const;

export default function UploadQuotes() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [search, setSearch] = useState("");

  const [selectedRequest, setSelectedRequest] = useState<PurchaseRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lines, setLines] = useState<PurchaseRequestLine[]>([]);
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);

  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [purchaseValue, setPurchaseValue] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestingApproval, setRequestingApproval] = useState(false);

  async function loadList(): Promise<void> {
    setLoading(true);
    try {
      const res = await purchaseRequestService.list({
        status: "IN_QUOTATION",
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
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadList();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, search]);

  async function loadDetail(requestId: number): Promise<void> {
    setDetailLoading(true);
    try {
      const [linesRes, suppliersRes, quotesRes] = await Promise.all([
        purchaseRequestLineService.list(requestId, { limit: 1000 }),
        supplierService.list({ limit: 1000 }),
        quoteService.list(requestId, { limit: 1000 }),
      ]);
      const products = await Promise.all(
        [...new Set(linesRes.items.map((line) => line.productId))].map((productId) => productService.getById(productId)),
      );
      setLines(linesRes.items);
      setProductNames(new Map(products.map((product) => [product.id, product.name])));
      setSuppliers(suppliersRes.items);
      setQuotes(quotesRes.items);
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

  function resetFormFields(): void {
    setSelectedProductId("");
    setSelectedSupplierId("");
    setPurchaseValue("");
    setAttachmentFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleBackToList(): void {
    setSelectedRequest(null);
    setLines([]);
    setProductNames(new Map());
    setSuppliers([]);
    setQuotes([]);
    resetFormFields();
  }

  function validate(): void {
    if (!selectedProductId) throw createValidationError("Debe seleccionar el producto");
    if (!selectedSupplierId) throw createValidationError("Debe seleccionar el proveedor");
    const parsedValue = Number(purchaseValue);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      throw createValidationError("El valor de compra debe ser un numero mayor a cero");
    }
  }

  async function handleAddQuote(): Promise<void> {
    if (!selectedRequest) return;
    setSubmitting(true);
    try {
      validate();
      const quote = await quoteService.create({
        requestId: selectedRequest.id,
        productId: selectedProductId,
        supplierId: Number(selectedSupplierId),
        purchaseValue: Number(purchaseValue),
      });
      if (attachmentFile) {
        await quoteService.uploadAttachment(quote.id, attachmentFile);
      }
      showSuccessToast("Cotización cargada exitosamente");
      resetFormFields();
      await loadDetail(selectedRequest.id);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestApproval(): Promise<void> {
    if (!selectedRequest) return;
    if (quotes.length === 0) {
      showErrorToast("Debe cargar al menos una cotización antes de solicitar autorización");
      return;
    }
    setRequestingApproval(true);
    try {
      await purchaseRequestService.requestQuoteApproval(selectedRequest.id);
      showSuccessToast(`Autorización solicitada para ${selectedRequest.requestNumber}`);
      handleBackToList();
      await loadList();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setRequestingApproval(false);
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
                {/* CARGAR COTIZACION */}
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h2 className="mb-3 text-sm font-semibold text-slate-600">Cargar Cotización</h2>
                  <div className="grid grid-cols-1 max-[799px]:grid-cols-1 min-[800px]:grid-cols-6 min-[1000px]:grid-cols-8 min-[1200px]:grid-cols-10 min-[1400px]:grid-cols-12 gap-4">
                    <div className="w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
                      <Field label="Producto" htmlFor="selectedProductId">
                        <Select
                          id="selectedProductId"
                          className="bg-zinc-100 focus:bg-indigo-100"
                          value={selectedProductId}
                          onChange={(e) => setSelectedProductId(e.target.value)}
                        >
                          <option value="">Seleccione el producto</option>
                          {[...new Set(lines.map((line) => line.productId))].map((productId) => (
                            <option key={productId} value={productId}>
                              {productNames.get(productId) ?? productId}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <div className="w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
                      <Field label="Proveedor" htmlFor="selectedSupplierId">
                        <Select
                          id="selectedSupplierId"
                          className="bg-zinc-100 focus:bg-indigo-100"
                          value={selectedSupplierId}
                          onChange={(e) => setSelectedSupplierId(e.target.value)}
                        >
                          <option value="">Seleccione el proveedor</option>
                          {suppliers.map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>
                              {supplier.businessPartner.legalName}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <div className="w-full min-[800px]:col-span-2 min-[1000px]:col-span-3 min-[1200px]:col-span-2 min-[1400px]:col-span-2">
                      <Field label="Valor de Compra" htmlFor="purchaseValue">
                        <Input
                          id="purchaseValue"
                          type="number"
                          min={0}
                          step="0.01"
                          value={purchaseValue}
                          onChange={(e) => setPurchaseValue(e.target.value)}
                          className="bg-zinc-100 focus:bg-indigo-100"
                        />
                      </Field>
                    </div>
                    <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-6 min-[1400px]:col-span-6">
                      <Field label="Comprobante (PDF/imagen, opcional)" htmlFor="attachmentFile">
                        <Input
                          ref={fileInputRef}
                          id="attachmentFile"
                          type="file"
                          accept="application/pdf,image/jpeg,image/png"
                          onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)}
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
                      onClick={() => void handleAddQuote()}
                      className="w-60"
                    >
                      Agregar Cotización
                    </Button>
                  </div>
                </div>

                {/* COTIZACIONES CARGADAS */}
                <div className="mt-6">
                  <h2 className="mb-3 text-sm font-semibold text-slate-600">Cotizaciones cargadas</h2>
                  {quotes.length === 0 ? (
                    <EmptyState title="Sin cotizaciones" description="Todavía no se cargó ninguna cotización." />
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-2 text-left font-semibold text-slate-600">N° Cotización</th>
                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Producto</th>
                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Proveedor</th>
                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Valor</th>
                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {quotes.map((quote) => (
                            <tr key={quote.id}>
                              <td className="px-4 py-2 font-medium text-slate-900">{quote.quoteNumber}</td>
                              <td className="px-4 py-2 text-slate-600">
                                {productNames.get(quote.productId) ?? quote.productId}
                              </td>
                              <td className="px-4 py-2 text-slate-600">
                                {suppliers.find((supplier) => supplier.id === quote.supplierId)?.businessPartner
                                  .legalName ?? quote.supplierId}
                              </td>
                              <td className="px-4 py-2 text-slate-600">{quote.purchaseValue}</td>
                              <td className="px-4 py-2 text-slate-600">{quote.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-center">
                  <Button
                    type="button"
                    loading={requestingApproval}
                    disabled={quotes.length === 0}
                    onClick={() => void handleRequestApproval()}
                    className="w-60"
                  >
                    Solicitar Autorización
                  </Button>
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
          Cargar Cotizaciones
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
            <EmptyState
              title="Sin solicitudes"
              description="No hay solicitudes en etapa de cotización."
            />
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
