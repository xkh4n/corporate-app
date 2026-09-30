import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Button, EmptyState, Spinner } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { downloadBlob } from "../../lib/downloadBlob";
import { inventoryCountService } from "../../services";
import type { InventoryCountDetail, InventoryCountReport } from "../../types/inventoryCount";
import { formatDateTime, statusLabel } from "./inventoryLabels";
import { LineBadges } from "./LineBadges";
import { NewLabelsPanel } from "./NewLabelsPanel";

const TH = "whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600";

function SummaryCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
      <div className="text-2xl font-bold text-slate-800">{value ?? "-"}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

// Toma cerrada: totales, equipos levantados con sus diferencias, activos del
// sistema que no se vieron (congelados al cerrar) y las etiquetas nuevas.
export function InventoryReport({ count }: { count: InventoryCountDetail }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [report, setReport] = useState<InventoryCountReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await inventoryCountService.report(count.id);
        if (!cancelled) setReport(res);
      } catch (error) {
        if (!cancelled) handleError(error, navigate);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [count.id, navigate]);

  async function handleDownloadPdf(): Promise<void> {
    setDownloading(true);
    try {
      const blob = await inventoryCountService.downloadReportPdf(count.id);
      downloadBlob(blob, `inventario-${count.number}.pdf`);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (!report) return <EmptyState title="Sin reporte" description="No se pudo cargar el reporte de la toma." />;

  const { summary, lines, missingAssets, auditor } = report;

  return (
    <div>
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0 break-words">
            <h2 className="text-lg font-semibold text-slate-800">{count.number}</h2>
            <p className="text-sm text-slate-600">{count.name}</p>
            <p className="mt-1 text-xs text-slate-500">
              Auditor: {auditor ? `${auditor.fullName} (${auditor.documentId})` : "-"} · Inicio:{" "}
              {formatDateTime(count.startedAt)} · Fin: {formatDateTime(count.closedAt)}
            </p>
          </div>
          <Button type="button" variant="secondary" className="w-full sm:w-auto" loading={downloading} onClick={() => void handleDownloadPdf()}>
            Descargar informe PDF
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <SummaryCard label="Equipos levantados" value={summary.totalLines} />
          <SummaryCard label="Vinculados" value={summary.linkedLines} />
          <SummaryCard label="Altas nuevas" value={summary.createdAssets} />
          <SummaryCard label="Con cambios" value={summary.withChanges} />
          <SummaryCard label="No encontrados" value={summary.missingAssets} />
        </div>
      </div>

      {summary.createdAssets > 0 && <NewLabelsPanel countId={count.id} labelCount={summary.createdAssets} />}

      {summary.createdAssets > 0 && can("asset-valuation:update") && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-emerald-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            Los {summary.createdAssets} activo(s) nuevo(s) no tienen valor. Asígneselo para registrar su alta en el Kardex.
          </p>
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => navigate("/assets/valuation")}>
            Asignar valor a los activos nuevos
          </Button>
        </div>
      )}

      <h2 className="mb-2 text-base font-semibold text-slate-800">Equipos levantados</h2>
      {lines.length === 0 ? (
        <EmptyState title="Sin equipos" description="La toma se cerró sin equipos levantados." />
      ) : (
        <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Tag</th>
                <th className={TH}>Producto</th>
                <th className={TH}>N° de serie</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Usuario</th>
                <th className={TH}>Centro de costo</th>
                <th className={TH}>Observación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">{line.tag}</td>
                  <td className="min-w-[10rem] px-4 py-2 text-slate-600">
                    {line.productName ?? "-"}
                    {line.categoryName && <div className="text-xs text-slate-400">{line.categoryName}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">{line.serialNumber ?? "-"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">{statusLabel(line.statusCode)}</td>
                  <td className="min-w-[10rem] px-4 py-2 text-slate-600">{line.holder?.fullName ?? "-"}</td>
                  <td className="min-w-[10rem] px-4 py-2 text-slate-600">
                    {line.costCenter ? `${line.costCenter.code} · ${line.costCenter.name}` : "-"}
                  </td>
                  <td className="min-w-[12rem] px-4 py-2">
                    <LineBadges line={line} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 text-base font-semibold text-slate-800">Activos del sistema no encontrados</h2>
      {missingAssets.length === 0 ? (
        <EmptyState title="Todo encontrado" description="Todos los activos del sistema aparecieron en la toma." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Tag</th>
                <th className={TH}>Producto</th>
                <th className={TH}>N° de serie</th>
                <th className={TH}>Estado en sistema</th>
                <th className={TH}>Usuario en sistema</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {missingAssets.map((asset) => (
                <tr key={asset.assetId}>
                  <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">{asset.tag}</td>
                  <td className="min-w-[10rem] px-4 py-2 text-slate-600">{asset.productName ?? "-"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">{asset.serialNumber ?? "-"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">{statusLabel(asset.systemStatusCode)}</td>
                  <td className="min-w-[10rem] px-4 py-2 text-slate-600">{asset.systemHolder?.fullName ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
