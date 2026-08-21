import { useState } from "react";
import { Link } from "react-router-dom";
import { IoNotificationsOutline } from "react-icons/io5";
import { useNotifications } from "../notifications/useNotifications";

interface Row {
  key: string;
  label: string;
  count: number;
  to: string;
}

// Dropdown de 3 filas (una por tipo de pendiente derivado, ver
// notification.service.ts en corporate-api), cada una oculta si su conteo
// es 0. El conteo se actualiza solo via NotificationsProvider (push por
// socket + refetch), este componente es puramente de presentacion.
export function NotificationBell() {
  const { summary } = useNotifications();
  const [open, setOpen] = useState(false);

  const rows: Row[] = [
    { key: "requests", label: "Solicitudes por aprobar", count: summary.pendingRequestApprovals, to: "/tickets/validate" },
    { key: "quotes", label: "Cotizaciones por autorizar", count: summary.pendingQuoteApprovals, to: "/quotes/approve" },
    { key: "orders", label: "Órdenes de compra por adjuntar", count: summary.pendingPurchaseOrders, to: "/purchase-orders/attach" },
  ].filter((row) => row.count > 0);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notificaciones"
        className="relative rounded-md p-2 text-zinc-200 hover:bg-blue-900"
      >
        <IoNotificationsOutline className="h-5 w-5" />
        {summary.total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {summary.total > 99 ? "99+" : summary.total}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-2 w-72 rounded-lg border border-slate-200 bg-white shadow-lg">
            {rows.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Sin pendientes.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <li key={row.key}>
                    <Link
                      to={row.to}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <span>{row.label}</span>
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        {row.count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
