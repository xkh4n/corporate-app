import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Select } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { serviceDeskReportService } from "../../services/serviceDeskService";
import type { ServiceDeskSummary } from "../../types/serviceDesk";
import { CARD, Loading, Section, TD, TH } from "./components";
import { PRIORITY_LABELS, STATUS_LABELS } from "./serviceDeskLabels";

// Indicadores del Service Desk (plan 009, fase 9E).

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={CARD}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-800">{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const pct = (value: number | null) => (value === null ? "-" : `${value}%`);

// Barra horizontal simple (proporcion sobre el maximo de la lista).
function Bars({ rows }: { rows: { label: string; value: number; extra?: string }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) return <p className="text-sm text-slate-500">Sin datos.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex justify-between gap-2">
            <span className="text-slate-700">{row.label}</span>
            <span className="font-medium text-slate-800">
              {row.value}
              {row.extra ? ` ${row.extra}` : ""}
            </span>
          </div>
          <div className="mt-0.5 h-2 rounded bg-slate-100" aria-hidden>
            <div className="h-2 rounded bg-sky-600" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReportsTab() {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<ServiceDeskSummary | null>(null);

  useEffect(() => {
    setSummary(null);
    serviceDeskReportService
      .summary(days)
      .then(setSummary)
      .catch((error) => handleError(error, navigate));
  }, [days, navigate]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="report-days" className="text-slate-700">
          Período:
        </label>
        <Select id="report-days" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          <option value="7">Últimos 7 días</option>
          <option value="30">Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="365">Último año</option>
        </Select>
      </div>
      {!summary ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Tickets creados" value={String(summary.created)} hint={`${summary.resolved} resueltos`} />
            <Tile label="Cumplimiento SLA resolución" value={pct(summary.slaCompliance)} hint={`Respuesta: ${pct(summary.responseCompliance)}`} />
            <Tile label="Tiempo medio de resolución" value={summary.mttrHours === null ? "-" : `${summary.mttrHours} h`} hint="Horas corridas" />
            <Tile label="Resolución al primer contacto" value={pct(summary.firstContactResolution)} hint={`Reaperturas: ${pct(summary.reopenRate)}`} />
            <Tile
              label="Satisfacción (CSAT)"
              value={summary.csatAverage === null ? "-" : `${summary.csatAverage} / 5`}
              hint={`${summary.csatResponses} respuestas`}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Cola abierta por estado">
              <Bars rows={summary.backlogByStatus.map((row) => ({ label: STATUS_LABELS[row.status] ?? row.status, value: row.total }))} />
            </Section>
            <Section title="Cola abierta por grupo">
              <Bars rows={summary.backlogByGroup.map((row) => ({ label: row.groupName, value: row.total, extra: row.breached > 0 ? `(${row.breached} vencidos)` : undefined }))} />
            </Section>
            <Section title="Tickets por prioridad">
              <Bars rows={summary.byPriority.map((row) => ({ label: PRIORITY_LABELS[row.priority] ?? row.priority, value: row.total }))} />
            </Section>
            <Section title="Categorías más frecuentes">
              <Bars rows={summary.topCategories.map((row) => ({ label: row.name, value: row.total }))} />
            </Section>
          </div>
          <Section title="Activos con más incidentes">
            {summary.topAssets.length === 0 ? (
              <p className="text-sm text-slate-500">Sin incidentes con activos en el período.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={TH}>Activo</th>
                      <th className={TH}>Incidentes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summary.topAssets.map((asset) => (
                      <tr key={asset.assetId} className={asset.incidents >= 3 ? "bg-red-50" : undefined}>
                        <td className={TD}>{asset.tag}</td>
                        <td className={TD}>{asset.incidents}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">Un activo con 3 o más incidentes es candidato a un problema.</p>
          </Section>
        </>
      )}
    </div>
  );
}
