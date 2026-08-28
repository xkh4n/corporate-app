import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Button, Input, EmptyState } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { purchaseOrderService, purchaseRequestService, supplierContactService, supplierService } from "../../services";
import type { PurchaseOrder, PurchaseRequest, Supplier, SupplierContact } from "../../types";

// Paso 7 del flujo: el analista de adquisiciones (mismo permiso que abrir/
// cerrar la etapa de cotizacion, quotes:create) envia la OC + la cotizacion
// ganadora al proveedor por correo.
const REQUIRED_PERMISSIONS = [
  "purchase-requests:read",
  "purchase-orders:read",
  "quotes:create",
  "suppliers:read",
  "supplier-contacts:read",
] as const;

interface OrderDetail {
  order: PurchaseOrder;
  supplier: Supplier | null;
  contacts: SupplierContact[];
  files: string[];
  sending: boolean;
}

export default function SendPurchaseOrder() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [search, setSearch] = useState("");

  const [selectedRequest, setSelectedRequest] = useState<PurchaseRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [orderDetails, setOrderDetails] = useState<OrderDetail[]>([]);

  async function loadList(): Promise<void> {
    setLoading(true);
    try {
      // OC_GENERATED: todavia falta enviar. PENDING_DELIVERY: puede seguir
      // apareciendo aca si la solicitud tiene mas de una OC (una por
      // cotizacion ganadora) y todavia no se enviaron todas -ver el
      // comentario sobre idempotencia en sendPurchaseOrderToSupplier
      // (purchaseOrder.service.ts).
      const res = await purchaseRequestService.list({
        status: "OC_GENERATED,PENDING_DELIVERY",
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
      const [ordersRes, suppliersRes] = await Promise.all([
        purchaseOrderService.list({ requestId, limit: 1000 }),
        supplierService.list({ limit: 1000 }),
      ]);

      const details = await Promise.all(
        ordersRes.items.map(async (order): Promise<OrderDetail> => {
          const supplier = suppliersRes.items.find((item) => item.id === order.supplierId) ?? null;
          const [contactsRes, documents] = await Promise.all([
            supplierContactService.list(order.supplierId, { limit: 1000 }),
            purchaseOrderService.listDocuments(order.id),
          ]);
          return { order, supplier, contacts: contactsRes.items, files: documents.files, sending: false };
        }),
      );
      setOrderDetails(details);
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
    setOrderDetails([]);
  }

  async function handleDownload(orderId: number, filename: string): Promise<void> {
    try {
      const blob = await purchaseOrderService.downloadDocumentFile(orderId, filename);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      handleError(error, navigate);
    }
  }

  async function handleSend(orderId: number): Promise<void> {
    if (!selectedRequest) return;
    setOrderDetails((prev) => prev.map((item) => (item.order.id === orderId ? { ...item, sending: true } : item)));
    try {
      const result = await purchaseOrderService.sendToSupplier(orderId);
      if (result.sent) {
        showSuccessToast("Orden de compra enviada al proveedor exitosamente");
      }
      const refreshed = await purchaseRequestService.getById(selectedRequest.id);
      setSelectedRequest(refreshed);
      setRequests((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
      // sentAt es por-orden (una solicitud puede tener varias OC a distintos
      // proveedores) -recargar el detalle es lo que hace aparecer "Enviada"/
      // "Reenviar" en la orden puntual que se acaba de mandar.
      await loadDetail(selectedRequest.id);
    } catch (error) {
      // 502 (mailer caido/sin contactos): el status NO cambia, se puede
      // reintentar apenas se resuelva -mismo criterio que sendQuoteEmail en
      // purchaseRequest.controller.ts.
      handleError(error, navigate);
    } finally {
      setOrderDetails((prev) => prev.map((item) => (item.order.id === orderId ? { ...item, sending: false } : item)));
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
            ) : orderDetails.length === 0 ? (
              <EmptyState title="Sin órdenes" description="Esta solicitud todavía no tiene ninguna orden de compra emitida." />
            ) : (
              <div className="space-y-4">
                {orderDetails.map((detail) => (
                  <div key={detail.order.id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-semibold text-slate-800">
                        Orden {detail.order.orderNumber}
                        {detail.order.quote && <span className="text-slate-500 font-normal"> — {detail.order.quote.productCode ?? detail.order.quote.model ?? detail.order.quote.productId}</span>}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          detail.order.sentAt ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {detail.order.sentAt ? "Enviada" : "Pendiente de envío"}
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-slate-600 min-[800px]:grid-cols-2">
                      <p>
                        <span className="font-semibold text-slate-700">Proveedor:</span>{" "}
                        {detail.supplier?.businessPartner.legalName ?? detail.order.supplierId}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-700">Condiciones de pago:</span>{" "}
                        {detail.order.paymentTerms ?? "-"}
                      </p>
                    </div>

                    <div className="mt-3">
                      <p className="text-xs font-semibold text-slate-600">Contactos del proveedor</p>
                      {detail.contacts.length === 0 ? (
                        <p className="text-sm text-rose-600">Sin contactos registrados -no se puede enviar hasta agregar uno.</p>
                      ) : (
                        <ul className="mt-1 text-sm text-slate-600">
                          {detail.contacts.map((contact) => (
                            <li key={contact.id}>
                              {contact.name} — {contact.email}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="mt-3">
                      <p className="text-xs font-semibold text-slate-600">Documentos a enviar</p>
                      {detail.files.length === 0 ? (
                        <p className="text-sm text-slate-500">Sin documentos consolidados todavía.</p>
                      ) : (
                        <div className="mt-1 flex flex-wrap gap-2">
                          {detail.files.map((filename) => (
                            <button
                              key={filename}
                              type="button"
                              onClick={() => void handleDownload(detail.order.id, filename)}
                              className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                            >
                              {filename}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex justify-end">
                      <Button
                        type="button"
                        variant={detail.order.sentAt ? "secondary" : "success"}
                        loading={detail.sending}
                        disabled={detail.contacts.length === 0}
                        onClick={() => void handleSend(detail.order.id)}
                      >
                        {detail.order.sentAt ? "Reenviar al proveedor" : "Enviar al proveedor"}
                      </Button>
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
          Enviar Orden de Compra
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
            <EmptyState title="Sin pendientes" description="No hay órdenes de compra pendientes de enviar." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">N° Solicitud</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Solicitante</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Estado</th>
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
                      <td className="px-4 py-2">
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                          {request.status}
                        </span>
                      </td>
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
