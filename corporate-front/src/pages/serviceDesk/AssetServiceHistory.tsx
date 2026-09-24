import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Spinner } from "../../components/ui";
import { serviceTicketService } from "../../services/serviceDeskService";
import type { AssetServiceRecord, ChangeStatus, ProblemStatus, TicketStatus } from "../../types/serviceDesk";
import { formatDateTime } from "../inventario/inventoryLabels";
import { TD, TH } from "./components";
import { CHANGE_STATUS_LABELS, CHANGE_TYPE_LABELS, PROBLEM_STATUS_LABELS, STATUS_LABELS, TYPE_LABELS } from "./serviceDeskLabels";

// Historial de servicio de un activo (plan 009, fase 9B): tickets, problemas y
// cambios que lo involucran. Se muestra en la ficha Kardex del activo.

const KIND_LABELS: Record<AssetServiceRecord["kind"], string> = { TICKET: "Ticket", PROBLEM: "Problema", CHANGE: "Cambio" };

function statusText(record: AssetServiceRecord): string {
  if (record.kind === "TICKET") return STATUS_LABELS[record.status as TicketStatus] ?? record.status;
  if (record.kind === "PROBLEM") return PROBLEM_STATUS_LABELS[record.status as ProblemStatus] ?? record.status;
  return CHANGE_STATUS_LABELS[record.status as ChangeStatus] ?? record.status;
}

function typeText(record: AssetServiceRecord): string {
  if (record.kind === "TICKET") return TYPE_LABELS[record.type as "INCIDENT" | "SERVICE_REQUEST"] ?? record.type;
  if (record.kind === "CHANGE") return `Cambio ${CHANGE_TYPE_LABELS[record.type as keyof typeof CHANGE_TYPE_LABELS] ?? record.type}`;
  return "Problema";
}

export function AssetServiceHistory({ assetId }: { assetId: number }) {
  const { can } = useAuth();
  const allowed = can("service-tickets:read");
  const [records, setRecords] = useState<AssetServiceRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setRecords(null);
    setFailed(false);
    if (!allowed) return;
    serviceTicketService
      .assetHistory(assetId)
      .then(setRecords)
      // Sin permiso o sin Service Desk: la seccion simplemente no se muestra.
      .catch(() => setFailed(true));
  }, [assetId, allowed]);

  if (!allowed || failed) return null;

  function linkOf(record: AssetServiceRecord): string | null {
    if (record.kind === "TICKET" && can("service-tickets:read")) return `/support-services?tab=queue&ticket=${record.id}`;
    if (record.kind === "PROBLEM" && can("service-problems:read")) return `/support-services?tab=problems&problem=${record.id}`;
    if (record.kind === "CHANGE" && can("service-changes:read")) return `/support-services?tab=changes&change=${record.id}`;
    return null;
  }

  const incidents = records?.filter((record) => record.kind === "TICKET" && record.type === "INCIDENT").length ?? 0;

  return (
    <div className="mt-6">
      <h3 className="mb-2 font-semibold text-slate-700">Historial de servicio</h3>
      {!records ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : records.length === 0 ? (
        <p className="text-sm text-slate-500">Este activo no tiene tickets, problemas ni cambios.</p>
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-600">{incidents} incidente(s) registrados.</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Registro</th>
                  <th className={TH}>Tipo</th>
                  <th className={TH}>Asunto</th>
                  <th className={TH}>Estado</th>
                  <th className={TH}>Creado</th>
                  <th className={TH}>Cerrado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((record) => {
                  const link = linkOf(record);
                  return (
                    <tr key={`${record.kind}-${record.id}`}>
                      <td className={TD}>
                        <span className="sr-only">{KIND_LABELS[record.kind]} </span>
                        {link ? (
                          <Link to={link} className="font-semibold text-brand-700 hover:underline">
                            {record.number}
                          </Link>
                        ) : (
                          record.number
                        )}
                      </td>
                      <td className={TD}>{typeText(record)}</td>
                      <td className={TD}>{record.title}</td>
                      <td className={TD}>{statusText(record)}</td>
                      <td className={`${TD} whitespace-nowrap`}>{formatDateTime(record.createdAt)}</td>
                      <td className={`${TD} whitespace-nowrap`}>{formatDateTime(record.closedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
