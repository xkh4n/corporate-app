import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Alert, Button, EmptyState, Spinner } from "../../components/ui";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { downloadBlob } from "../../lib/downloadBlob";
import { assetImportService } from "../../services/assetImportService";
import type { ImportJobState, ImportJobStatus } from "../../types/assetImport";

// Carga masiva de activos desde un CSV (solo altas). Flujo: subir el archivo lo VALIDA completo sin crear nada;
// si está bien se inicia la carga, que el servidor procesa fila a fila y RETOMA sola si se cae (el avance vive en
// Redis). La carga se identifica por `?job=` en la URL: se puede recargar la página o volver más tarde.
// La pantalla se ve con :read (igual que el menú y el GET de la API); subir e iniciar exige :create.
const REQUIRED_PERMISSIONS = ["asset-imports:read"] as const;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const POLL_INTERVAL_MS = 2000;
// Sin avance durante este tiempo se ofrece "Reanudar" (el servidor lo retoma solo, pero puede tardar ~1 minuto).
const STALLED_AFTER_MS = 45_000;
const TH = "px-4 py-2 text-left font-semibold text-slate-600";
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UTF8_BOM = String.fromCharCode(0xfeff);

const STATUS_LABELS: Record<ImportJobStatus, string> = {
  VALIDATED: "Validada, lista para iniciar",
  RUNNING: "En proceso",
  DONE: "Terminada",
  CANCELLED: "Cancelada",
  FAILED: "Detenida por errores repetidos",
};

const COLUMNS_HELP: { column: string; required: string; description: string }[] = [
  { column: "serial_number", required: "Sí", description: "Serie del equipo (letras, números y . _ / -). No puede repetirse ni existir ya en el sistema." },
  { column: "product", required: "Sí", description: "Nombre exacto del producto (debe estar activo)." },
  { column: "category", required: "No", description: "Categoría del producto; si viene, debe coincidir con la del producto." },
  { column: "cost_center_code", required: "Sí", description: "Código numérico del centro de costo donde queda el equipo." },
  { column: "status", required: "No", description: "AVAILABLE (por defecto), ASSIGNED, SUPPORT o DAMAGED." },
  { column: "assigned_username / assigned_rut", required: "Si ASSIGNED", description: "Usuario activo al que se asigna, por su usuario o por su RUT (solo uno de los dos)." },
  { column: "warranty_expires_at", required: "No", description: "Fin de la garantía, formato AAAA-MM-DD." },
];

const TEMPLATE_CSV = [
  "serial_number,product,category,cost_center_code,status,assigned_username,assigned_rut,warranty_expires_at",
  "SN-0001,NOMBRE EXACTO DEL PRODUCTO,,5802,AVAILABLE,,,2028-12-31",
  "SN-0002,NOMBRE EXACTO DEL PRODUCTO,,5802,ASSIGNED,usuario.ejemplo,,",
].join("\r\n");

export default function ImportAssets() {
  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <ImportContent />
    </RequirePermissions>
  );
}

function ImportContent() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canCreate = can("asset-imports:create");
  const [searchParams, setSearchParams] = useSearchParams();
  // El id viene de la URL y forma parte de la ruta de la API: solo se acepta un UUID (nada de "../" ni otros caracteres).
  const rawJobId = searchParams.get("job");
  const jobId = rawJobId !== null && JOB_ID_PATTERN.test(rawJobId) ? rawJobId : null;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [job, setJob] = useState<ImportJobState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stalled, setStalled] = useState(false);
  // Último avance visto, para detectar una carga que se quedó sin proceso.
  const progressRef = useRef({ cursor: -1, changedAt: 0 });

  const loadJob = useCallback(
    async (id: string, silent = false): Promise<void> => {
      if (!silent) setLoading(true);
      try {
        const state = await assetImportService.status(id);
        setJob(state);
        if (state.meta.cursor !== progressRef.current.cursor) {
          progressRef.current = { cursor: state.meta.cursor, changedAt: Date.now() };
        }
        setStalled(state.meta.status === "RUNNING" && Date.now() - progressRef.current.changedAt > STALLED_AFTER_MS);
      } catch (error) {
        // Una carga vencida o ajena se muestra como pantalla vacía; el resto de errores sigue el manejo normal.
        setJob(null);
        setSearchParams({}, { replace: true });
        handleError(error, navigate);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [navigate, setSearchParams],
  );

  useEffect(() => {
    progressRef.current = { cursor: -1, changedAt: Date.now() };
    if (jobId) void loadJob(jobId);
    else setJob(null);
  }, [jobId, loadJob]);

  const status = job?.meta.status;
  useEffect(() => {
    if (!jobId || status !== "RUNNING") return;
    const timer = window.setInterval(() => void loadJob(jobId, true), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [jobId, status, loadJob]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      showErrorToast("El archivo debe ser un .csv");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showErrorToast("El archivo supera el máximo de 2 MB");
      return;
    }
    setBusy(true);
    try {
      const report = await assetImportService.validate(file);
      setSearchParams({ job: report.jobId });
      if (report.invalidRows === 0) showSuccessToast(`Archivo validado: ${report.validRows} fila(s) listas para cargar`);
      else showErrorToast(`El archivo tiene ${report.invalidRows} fila(s) con errores`);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<unknown>, successMessage?: string): Promise<void> {
    if (!jobId) return;
    setBusy(true);
    try {
      await action();
      if (successMessage) showSuccessToast(successMessage);
      progressRef.current = { cursor: -1, changedAt: Date.now() };
      await loadJob(jobId, true);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadResult(): Promise<void> {
    if (!jobId) return;
    setBusy(true);
    try {
      downloadBlob(await assetImportService.downloadResult(jobId), `resultado-carga-${jobId}.csv`);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setBusy(false);
    }
  }

  function handleDownloadTemplate(): void {
    // BOM para que Excel abra el UTF-8 con sus acentos.
    downloadBlob(new Blob([UTF8_BOM, TEMPLATE_CSV, "\r\n"], { type: "text/csv;charset=utf-8" }), "plantilla-carga-activos.csv");
  }

  const meta = job?.meta;
  const finished = meta?.status === "DONE" || meta?.status === "CANCELLED" || meta?.status === "FAILED";
  const percent = meta && meta.validRows > 0 ? Math.min(100, Math.round((meta.cursor / meta.validRows) * 100)) : 0;

  return (
    <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
      <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-2 text-center text-gray-600">Carga Masiva de Activos</h1>
      <p className="mb-6 max-w-3xl text-center text-sm text-slate-600">
        Da de alta activos desde un archivo CSV. Solo crea activos nuevos: una serie que ya existe se rechaza. El valor se
        asigna después en Valorización.
      </p>

      <div className="w-full max-w-5xl space-y-4">
        {canCreate && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 font-semibold text-slate-700">1. Subir el archivo</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void handleFileChange(e)} />
              <Button type="button" loading={busy && !meta} onClick={() => fileInputRef.current?.click()}>
                Seleccionar archivo CSV
              </Button>
              <Button type="button" variant="secondary" onClick={handleDownloadTemplate}>
                Descargar plantilla
              </Button>
              <span className="text-xs text-slate-500">Máximo 2 MB y 5.000 filas. Al subirlo se valida sin crear nada.</span>
            </div>
            <details className="mt-3 text-sm text-slate-600">
              <summary className="cursor-pointer font-medium">Columnas del archivo</summary>
              <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={TH}>Columna</th>
                      <th className={TH}>Obligatoria</th>
                      <th className={TH}>Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {COLUMNS_HELP.map((row) => (
                      <tr key={row.column}>
                        <td className="px-3 py-1 font-mono">{row.column}</td>
                        <td className="px-3 py-1">{row.required}</td>
                        <td className="px-3 py-1">{row.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !job || !meta ? (
          <EmptyState title="Sin carga en curso" description="Sube un archivo CSV para validarlo e iniciar la carga." />
        ) : (
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-slate-700">2. Carga «{meta.filename}»</h2>
              <span className="text-sm font-medium text-slate-600">{STATUS_LABELS[meta.status]}</span>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Stat label="Filas del archivo" value={meta.totalRows} />
              <Stat label="Válidas" value={meta.validRows} />
              <Stat label="Con errores" value={meta.invalidRows} tone={meta.invalidRows > 0 ? "warn" : undefined} />
              <Stat label="Creadas" value={meta.ok} tone="ok" />
              {(meta.status === "RUNNING" || finished) && <Stat label="Rechazadas al cargar" value={meta.failed} tone={meta.failed > 0 ? "warn" : undefined} />}
              {meta.status === "RUNNING" && <Stat label="Pendientes" value={job.pending} />}
            </dl>

            {(meta.status === "RUNNING" || finished) && meta.validRows > 0 && (
              <div>
                <div
                  className="h-3 w-full overflow-hidden rounded-full bg-slate-200"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-label="Avance de la carga"
                >
                  <div className="h-full bg-emerald-600 transition-all" style={{ width: `${percent}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {meta.cursor} de {meta.validRows} filas procesadas ({percent}%)
                  {meta.attempts > 1 && ` · retomada ${meta.attempts - 1} vez/veces tras una interrupción`}
                </p>
              </div>
            )}

            {stalled && (
              <Alert tone="warning">
                La carga no avanza desde hace un momento (el proceso que la ejecutaba pudo caerse). El servidor la retoma
                sola; puedes pedirlo ahora con «Reanudar». Lo ya creado no se duplica.
              </Alert>
            )}
            {meta.status === "FAILED" && (
              <Alert tone="error">
                La carga se detuvo por errores repetidos del servidor. Lo ya creado se conserva: descarga el resultado para
                ver hasta dónde llegó y vuelve a subir el archivo (las series ya cargadas se rechazan).
              </Alert>
            )}
            {meta.status === "VALIDATED" && meta.invalidRows > 0 && (
              <Alert tone="warning">
                Corrige el archivo y vuélvelo a subir, o carga solo las {meta.validRows} filas válidas (las demás quedan
                sin cargar y se listan en el resultado).
              </Alert>
            )}

            {job.issues.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-slate-700">Filas con errores</h3>
                <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className={TH}>Fila</th>
                        <th className={TH}>Columna</th>
                        <th className={TH}>Problema</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {job.issues.map((issue, index) => (
                        <tr key={`${issue.row}-${issue.column}-${index}`}>
                          <td className="px-3 py-1 font-medium">{issue.row}</td>
                          <td className="px-3 py-1 font-mono">{issue.column}</td>
                          <td className="px-3 py-1">{issue.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {job.issuesTotal > job.issues.length && (
                  <p className="mt-1 text-xs text-slate-500">
                    Se muestran {job.issues.length} de {job.issuesTotal} problemas; el resultado descargable incluye hasta 2.000.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {canCreate && meta.status === "VALIDATED" && meta.invalidRows === 0 && meta.validRows > 0 && (
                <Button type="button" variant="success" loading={busy} onClick={() => void run(() => assetImportService.start(meta.id, false), "Carga iniciada")}>
                  Iniciar carga ({meta.validRows} filas)
                </Button>
              )}
              {canCreate && meta.status === "VALIDATED" && meta.invalidRows > 0 && meta.validRows > 0 && (
                <Button type="button" variant="success" loading={busy} onClick={() => void run(() => assetImportService.start(meta.id, true), "Carga iniciada")}>
                  Cargar solo las {meta.validRows} filas válidas
                </Button>
              )}
              {canCreate && meta.status === "RUNNING" && (
                <Button type="button" variant="secondary" loading={busy} onClick={() => void run(() => assetImportService.resume(meta.id), "Reanudación solicitada")}>
                  Reanudar
                </Button>
              )}
              {canCreate && (meta.status === "VALIDATED" || meta.status === "RUNNING") && (
                <Button type="button" variant="secondary" loading={busy} onClick={() => void run(() => assetImportService.cancel(meta.id), "Carga cancelada")}>
                  Cancelar
                </Button>
              )}
              {(meta.status === "RUNNING" || finished) && (
                <Button type="button" variant="secondary" loading={busy} onClick={() => void handleDownloadResult()}>
                  Descargar resultado (CSV)
                </Button>
              )}
              {finished && (
                <Button type="button" variant="ghost" onClick={() => setSearchParams({})}>
                  Nueva carga
                </Button>
              )}
            </div>
            {meta.status === "RUNNING" && (
              <p className="text-xs text-slate-500">
                Puedes cerrar esta página: la carga sigue en el servidor y se retoma sola si se interrumpe. Vuelve con el mismo
                enlace para ver el avance.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-slate-800";
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-lg font-semibold ${color}`}>{value}</dd>
    </div>
  );
}
