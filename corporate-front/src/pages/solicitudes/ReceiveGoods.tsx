import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Field, Select, Button, Input, EmptyState } from "../../components/ui";
import { showSuccessToast, showErrorToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import {
  authorizationService,
  goodsReceiptService,
  purchaseOrderService,
  purchaseRequestService,
  supplierService,
} from "../../services";
import type {
  Authorization,
  GoodsReceipt,
  GoodsReceiptDocumentType,
  PurchaseOrder,
  PurchaseRequest,
  Quote,
  Supplier,
} from "../../types";

// Paso 8 del flujo: registrar la recepcion de mercaderia contra una OC ya
// enviada al proveedor (PENDING_DELIVERY). No restringido al solicitante
// original -es tarea de bodega/logistica, cualquier usuario con
// goods-receipts:create puede recepcionar cualquier solicitud pendiente.
const REQUIRED_PERMISSIONS = [
  "purchase-requests:read",
  "purchase-orders:read",
  // "read" ademas de "create": loadDetail llama a GET /goods-receipts por
  // cada orden (goodsReceiptService.list) para calcular cuanto ya se
  // recibio y mostrar el historial -sin este permiso esa consulta 403ea.
  "goods-receipts:read",
  "goods-receipts:create",
  "authorizations:read",
  "authorizations:create",
  "suppliers:read",
] as const;

const DOCUMENT_TYPE_OPTIONS: { value: GoodsReceiptDocumentType; label: string }[] = [
  { value: "GUIA_DESPACHO", label: "Guía de despacho" },
  { value: "BOLETA", label: "Boleta" },
  { value: "FACTURA", label: "Factura" },
];

function quoteLabel(quote: Quote): string {
  return quote.productCode ?? quote.model ?? quote.productId;
}

function lineKey(orderId: number, quoteId: number): string {
  return `${orderId}:${quoteId}`;
}

// Una tarjeta por (orden, cotizacion): recibir es por producto/cotizacion,
// aunque varias cotizaciones ganadoras puedan compartir una misma OC
// consolidada (mismo proveedor). La autorizacion, lo ya recibido y el tope
// aprobado son todos por cotizacion -ver authorization.service.ts/
// isRequestFullyReceived en el backend, que nunca fueron por-orden.
interface ReceiptLine {
  order: PurchaseOrder;
  quote: Quote;
  authorization: Authorization | null;
  approvedQuantity: number;
  alreadyReceived: number;
  remaining: number;
  receipts: GoodsReceipt[];
  documentType: GoodsReceiptDocumentType;
  documentNumber: string;
  receivedQuantity: string;
  serialNumbers: string[];
  receiptFile: File | null;
  authorizationFile: File | null;
  submitting: boolean;
}

export default function ReceiveGoods() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [search, setSearch] = useState("");

  const [selectedRequest, setSelectedRequest] = useState<PurchaseRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const linesByOrder = useMemo(() => {
    const map = new Map<number, { order: PurchaseOrder; lines: ReceiptLine[] }>();
    for (const line of lines) {
      const bucket = map.get(line.order.id);
      if (bucket) bucket.lines.push(line);
      else map.set(line.order.id, { order: line.order, lines: [line] });
    }
    return [...map.values()];
  }, [lines]);

  async function loadList(): Promise<void> {
    setLoading(true);
    try {
      const res = await purchaseRequestService.list({
        status: "PENDING_DELIVERY",
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

  function supplierName(supplierId: number): string {
    return suppliers.find((supplier) => supplier.id === supplierId)?.businessPartner.legalName ?? `Proveedor ${supplierId}`;
  }

  async function loadDetail(requestId: number): Promise<void> {
    setDetailLoading(true);
    try {
      const [ordersRes, suppliersRes] = await Promise.all([
        purchaseOrderService.list({ requestId, limit: 1000 }),
        supplierService.list({ limit: 1000 }),
      ]);
      setSuppliers(suppliersRes.items);

      const perOrder = await Promise.all(
        ordersRes.items.map(async (order) => {
          const receiptsRes = await goodsReceiptService.list(order.id, { limit: 1000 });
          const quotes = order.quotes ?? [];
          return Promise.all(
            quotes.map(async (quote): Promise<ReceiptLine> => {
              const authRes = await authorizationService.listByQuote(quote.id, { limit: 1 });
              const authorization = authRes.items[0] ?? null;
              const approvedQuantity = authorization?.approvedQuantity ?? 0;
              // Filtrado por cotizacion: goods-receipts se lista por ORDEN, y
              // una OC consolidada mezcla recepciones de varios productos.
              const receipts = receiptsRes.items.filter((receipt) => receipt.quoteId === quote.id);
              const alreadyReceived = receipts.reduce((sum, receipt) => sum + receipt.receivedQuantity, 0);
              const remaining = Math.max(approvedQuantity - alreadyReceived, 0);
              return {
                order,
                quote,
                authorization,
                approvedQuantity,
                alreadyReceived,
                remaining,
                receipts,
                documentType: "GUIA_DESPACHO",
                documentNumber: "",
                receivedQuantity: remaining > 0 ? String(remaining) : "",
                serialNumbers: remaining > 0 ? Array(remaining).fill("") : [],
                receiptFile: null,
                authorizationFile: null,
                submitting: false,
              };
            }),
          );
        }),
      );
      setLines(perOrder.flat());
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
    setLines([]);
  }

  function updateLine(key: string, patch: Partial<ReceiptLine>): void {
    setLines((prev) => prev.map((line) => (lineKey(line.order.id, line.quote.id) === key ? { ...line, ...patch } : line)));
  }

  // Cambiar la cantidad recibida redimensiona el array de series -uno por
  // unidad (decision B), preservando lo ya tipeado en las posiciones que
  // siguen existiendo.
  function handleQuantityChange(key: string, rawValue: string): void {
    setLines((prev) =>
      prev.map((line) => {
        if (lineKey(line.order.id, line.quote.id) !== key) return line;
        const parsed = Number(rawValue);
        const count = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
        const serialNumbers = Array.from({ length: count }, (_, i) => line.serialNumbers[i] ?? "");
        return { ...line, receivedQuantity: rawValue, serialNumbers };
      }),
    );
  }

  function handleSerialChange(key: string, index: number, value: string): void {
    setLines((prev) =>
      prev.map((line) => {
        if (lineKey(line.order.id, line.quote.id) !== key) return line;
        const serialNumbers = [...line.serialNumbers];
        serialNumbers[index] = value;
        return { ...line, serialNumbers };
      }),
    );
  }

  async function handleReceive(line: ReceiptLine): Promise<void> {
    if (!selectedRequest) return;
    const quantity = Number(line.receivedQuantity);
    if (!line.documentNumber.trim()) {
      showErrorToast("Debe indicar el número del documento");
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      showErrorToast("La cantidad recibida debe ser mayor a cero");
      return;
    }
    if (quantity > line.remaining) {
      showErrorToast(`No puede recibir más de ${line.remaining} unidad(es) pendientes para esta cotización`);
      return;
    }

    const key = lineKey(line.order.id, line.quote.id);
    updateLine(key, { submitting: true });
    try {
      const hasAnySerial = line.serialNumbers.some((serial) => serial.trim() !== "");
      const serialNumbers = hasAnySerial
        ? line.serialNumbers.map((serial) => (serial.trim() ? serial.trim() : null))
        : undefined;

      const receipt = await goodsReceiptService.create({
        documentType: line.documentType,
        documentNumber: line.documentNumber.trim(),
        purchaseOrderId: line.order.id,
        quoteId: line.quote.id,
        receivedQuantity: quantity,
        serialNumbers,
      });

      if (line.receiptFile) {
        await goodsReceiptService.uploadAttachment(receipt.id, line.receiptFile);
      }
      if (line.authorizationFile && line.authorization) {
        await authorizationService.uploadAttachment(line.authorization.id, line.authorizationFile);
      }

      showSuccessToast(
        `Recepción registrada: ${quantity} unidad(es) de ${quoteLabel(line.quote)} (orden ${line.order.orderNumber})`,
      );

      // El backend puede haber flipeado la solicitud a AVAILABLE (ya en la
      // primera recepcion, ver createGoodsReceipt) -se relee para reflejarlo,
      // aunque sigamos viendo el detalle (puede haber otras OC pendientes).
      const refreshed = await purchaseRequestService.getById(selectedRequest.id);
      setSelectedRequest(refreshed);
      if (refreshed.status !== "PENDING_DELIVERY") {
        setRequests((prev) => prev.filter((item) => item.id !== refreshed.id));
      } else {
        setRequests((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
      }
      await loadDetail(selectedRequest.id);
    } catch (error) {
      handleError(error, navigate);
      updateLine(key, { submitting: false });
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
            </div>

            {detailLoading ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : linesByOrder.length === 0 ? (
              <EmptyState title="Sin órdenes" description="Esta solicitud no tiene ninguna orden de compra enviada al proveedor." />
            ) : (
              <div className="space-y-6">
                {linesByOrder.map(({ order, lines: orderLines }) => (
                  <div key={order.id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-semibold text-slate-800">
                        Orden {order.orderNumber}{" "}
                        <span className="text-slate-500 font-normal">— {supplierName(order.supplierId)}</span>
                      </h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          orderLines.every((line) => line.remaining === 0)
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {orderLines.every((line) => line.remaining === 0) ? "Recepción completa" : "Recepción pendiente"}
                      </span>
                    </div>

                    <div className="mt-4 space-y-4">
                      {orderLines.map((line) => {
                        const key = lineKey(line.order.id, line.quote.id);
                        return (
                          <div key={key} className="rounded-md border border-slate-100 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h3 className="text-sm font-semibold text-slate-700">{quoteLabel(line.quote)}</h3>
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  line.remaining > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                                }`}
                              >
                                {line.remaining > 0 ? "Recepción pendiente" : "Recepción completa"}
                              </span>
                            </div>

                            <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-slate-600 min-[800px]:grid-cols-3">
                              <p>
                                <span className="font-semibold text-slate-700">Autorizado:</span> {line.approvedQuantity}
                              </p>
                              <p>
                                <span className="font-semibold text-slate-700">Recibido:</span> {line.alreadyReceived}
                                {" / "}
                                <span className="font-semibold text-slate-700">Pendiente:</span> {line.remaining}
                              </p>
                            </div>

                            {line.receipts.length > 0 && (
                              <div className="mt-3 overflow-x-auto">
                                <table className="min-w-full divide-y divide-slate-200 text-sm">
                                  <thead className="bg-slate-50">
                                    <tr>
                                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Documento</th>
                                      <th className="px-3 py-2 text-left font-semibold text-slate-600">N°</th>
                                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Cantidad</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {line.receipts.map((receipt) => (
                                      <tr key={receipt.id}>
                                        <td className="px-3 py-2 text-slate-600">{receipt.documentType}</td>
                                        <td className="px-3 py-2 text-slate-600">{receipt.documentNumber}</td>
                                        <td className="px-3 py-2 text-slate-600">{receipt.receivedQuantity}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {line.remaining > 0 && (
                              <div className="mt-4 border-t border-slate-100 pt-4">
                                <div className="grid grid-cols-1 gap-4 min-[800px]:grid-cols-4">
                                  <Field label="Tipo de documento" htmlFor={`documentType-${key}`}>
                                    <Select
                                      id={`documentType-${key}`}
                                      className="bg-zinc-100 focus:bg-indigo-100"
                                      value={line.documentType}
                                      onChange={(e) =>
                                        updateLine(key, {
                                          documentType: e.target.value as GoodsReceiptDocumentType,
                                        })
                                      }
                                    >
                                      {DOCUMENT_TYPE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </Select>
                                  </Field>
                                  <Field label="N° de documento" htmlFor={`documentNumber-${key}`}>
                                    <Input
                                      id={`documentNumber-${key}`}
                                      value={line.documentNumber}
                                      onChange={(e) => updateLine(key, { documentNumber: e.target.value })}
                                      className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                  </Field>
                                  <Field label="Cantidad recibida" htmlFor={`receivedQuantity-${key}`}>
                                    <Input
                                      id={`receivedQuantity-${key}`}
                                      type="number"
                                      min={1}
                                      max={line.remaining}
                                      value={line.receivedQuantity}
                                      onChange={(e) => handleQuantityChange(key, e.target.value)}
                                      className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                  </Field>
                                  <Field label="Comprobante de recepción (opcional)" htmlFor={`receiptFile-${key}`}>
                                    <Input
                                      id={`receiptFile-${key}`}
                                      type="file"
                                      accept="application/pdf,image/jpeg,image/png"
                                      onChange={(e) => updateLine(key, { receiptFile: e.target.files?.[0] ?? null })}
                                      className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                  </Field>
                                </div>

                                {line.serialNumbers.length > 0 && (
                                  <div className="mt-3">
                                    <p className="mb-2 text-xs font-semibold text-slate-600">
                                      Números de serie (opcional, uno por unidad)
                                    </p>
                                    <div className="grid grid-cols-2 gap-2 min-[800px]:grid-cols-4">
                                      {line.serialNumbers.map((serial, index) => (
                                        <Input
                                          key={index}
                                          placeholder={`Unidad ${index + 1}`}
                                          value={serial}
                                          onChange={(e) => handleSerialChange(key, index, e.target.value)}
                                          className="bg-zinc-100 focus:bg-indigo-100"
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {line.authorization && (
                                  <div className="mt-3 max-w-sm">
                                    <Field
                                      label="PDF de la autorización de compra (opcional)"
                                      htmlFor={`authorizationFile-${key}`}
                                    >
                                      <Input
                                        id={`authorizationFile-${key}`}
                                        type="file"
                                        accept="application/pdf,image/jpeg,image/png"
                                        onChange={(e) =>
                                          updateLine(key, { authorizationFile: e.target.files?.[0] ?? null })
                                        }
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                      />
                                    </Field>
                                  </div>
                                )}

                                <div className="mt-4 flex justify-end">
                                  <Button
                                    type="button"
                                    variant="success"
                                    loading={line.submitting}
                                    onClick={() => void handleReceive(line)}
                                    className="w-60"
                                  >
                                    Registrar recepción
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
      <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          Recepcionar Mercadería
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
            <EmptyState title="Sin pendientes" description="No hay solicitudes con orden de compra enviada pendientes de recepción." />
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
