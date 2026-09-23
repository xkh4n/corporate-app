import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, EmptyState, Field, Input, Select, Spinner } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { assetAccountingService } from "../../services/assetAccountingService";
import type {
    AccountingRecord,
    DepreciationMethod,
    DepreciationRun,
    NextClosePreview,
    ScheduleRow,
} from "../../types/assetAccounting";
import { METHOD_LABEL, PERIOD_PATTERN, STAGE_LABEL, formatMoney, formatPeriod, parseAmount } from "./accountingLabels";
import { Pager } from "./Pager";

// Paso 4 (plan 007): parametros de depreciacion por activo (vida util, metodo,
// residual, inicio) con su tabla proyectada, y el cierre mensual que escribe
// la depreciacion del periodo en el Kardex. Los cierres van en orden y solo
// se anula el ultimo. Cerrar exige asset-depreciation:create; anular,
// asset-depreciation:delete; editar parametros, asset-accounting:update.
const REQUIRED_PERMISSIONS = ["asset-accounting:read", "asset-depreciation:read"] as const;
const PAGE_SIZE = 20;
const TH = "px-3 py-2 text-left font-semibold text-slate-600";

export default function Depreciacion() {
    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <DepreciationContent />
        </RequirePermissions>
    );
}

function DepreciationContent() {
    const navigate = useNavigate();
    const { can } = useAuth();
    const canUpdate = can("asset-accounting:update");
    const canClose = can("asset-depreciation:create");
    const canVoid = can("asset-depreciation:delete");

    // Cierre mensual
    const [preview, setPreview] = useState<NextClosePreview | null>(null);
    const [runs, setRuns] = useState<DepreciationRun[]>([]);
    const [runsPage, setRunsPage] = useState(1);
    const [runsTotalPages, setRunsTotalPages] = useState(1);
    const [runsTotal, setRunsTotal] = useState(0);
    const [showLines, setShowLines] = useState(false);
    const [confirmClose, setConfirmClose] = useState(false);
    const [pendingVoid, setPendingVoid] = useState<DepreciationRun | null>(null);
    const [closing, setClosing] = useState(false);

    // Activos capitalizados
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [records, setRecords] = useState<AccountingRecord[]>([]);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [selected, setSelected] = useState<AccountingRecord | null>(null);
    const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
    const [life, setLife] = useState("");
    const [method, setMethod] = useState<DepreciationMethod>("LINEAR");
    const [residual, setResidual] = useState("");
    const [start, setStart] = useState("");
    const [saving, setSaving] = useState(false);

    const loadClosing = useCallback(async () => {
        try {
            const [next, history] = await Promise.all([
                assetAccountingService.previewNextClose(),
                assetAccountingService.listRuns({ page: runsPage, limit: 10 }),
            ]);
            setPreview(next);
            setRuns(history.items);
            setRunsTotalPages(history.pagination.totalPages);
            setRunsTotal(history.pagination.totalItems);
        } catch (error) {
            handleError(error, navigate);
        }
    }, [runsPage, navigate]);

    const loadRecords = useCallback(async () => {
        setLoading(true);
        try {
            const res = await assetAccountingService.list({
                page,
                limit: PAGE_SIZE,
                search: search.trim() || undefined,
                status: "CAPITALIZED,DEPRECIATING,FULLY_DEPRECIATED",
                classification: "FIXED_ASSET",
            });
            setRecords(res.items);
            setTotalPages(res.pagination.totalPages);
            setTotalItems(res.pagination.totalItems);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setLoading(false);
        }
    }, [page, search, navigate]);

    useEffect(() => {
        void loadClosing();
    }, [loadClosing]);

    useEffect(() => {
        void loadRecords();
    }, [loadRecords]);

    async function select(record: AccountingRecord) {
        try {
            const res = await assetAccountingService.schedule(record.assetId);
            setSelected(res.record);
            setSchedule(res.rows);
            setLife(String(res.record.usefulLifeMonths ?? ""));
            setMethod(res.record.depreciationMethod ?? "LINEAR");
            setResidual(res.record.residualValue ?? "0");
            setStart(res.record.depreciationStartPeriod ?? "");
        } catch (error) {
            handleError(error, navigate);
        }
    }

    const editable = !!selected && selected.stage === "CAPITALIZED" && Number(selected.accumulatedDepreciation) === 0;
    // Solo el ultimo cierre CLOSED se puede anular (el backend lo exige igual).
    const lastClosedId = runs.find((run) => run.status === "CLOSED")?.id;

    async function handleSaveParams() {
        if (!selected) return;
        try {
            const lifeMonths = Number(life);
            const residualValue = parseAmount(residual);
            if (!Number.isInteger(lifeMonths) || lifeMonths < 1) throw createValidationError("La vida útil debe ser un entero de meses");
            if (residualValue === null || residualValue < 0) throw createValidationError("El valor residual no es válido");
            if (!PERIOD_PATTERN.test(start)) throw createValidationError("Indique el mes de inicio");
            setSaving(true);
            await assetAccountingService.updateDepreciation(selected.assetId, {
                usefulLifeMonths: lifeMonths,
                depreciationMethod: method,
                residualValue,
                depreciationStartPeriod: start,
            });
            showSuccessToast("Parámetros de depreciación actualizados");
            await select(selected);
            await Promise.all([loadRecords(), loadClosing()]);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setSaving(false);
        }
    }

    async function handleClose() {
        if (!preview?.period) return;
        try {
            setClosing(true);
            const run = await assetAccountingService.closePeriod(preview.period);
            showSuccessToast(
                `Período ${formatPeriod(run.period)} cerrado: ${run.assetCount} activos, ${formatMoney(run.totalAmount)}`,
            );
            setConfirmClose(false);
            setShowLines(false);
            await Promise.all([loadClosing(), loadRecords()]);
            if (selected) await select(selected);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setClosing(false);
        }
    }

    async function handleVoid() {
        if (!pendingVoid) return;
        try {
            setClosing(true);
            const run = await assetAccountingService.voidRun(pendingVoid.id);
            showSuccessToast(`Cierre de ${formatPeriod(run.period)} anulado: sus asientos se reversaron en el Kardex`);
            setPendingVoid(null);
            await Promise.all([loadClosing(), loadRecords()]);
            if (selected) await select(selected);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setClosing(false);
        }
    }

    const pager = <Pager page={page} totalPages={totalPages} totalItems={totalItems} noun="activos" onChange={setPage} />;
    const runsPager = (
        <Pager page={runsPage} totalPages={runsTotalPages} totalItems={runsTotal} noun="cierres" onChange={setRunsPage} />
    );

    return (
        <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Depreciación</h1>

            <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
                {/* CIERRE MENSUAL */}
                <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
                    <h2 className="text-base font-semibold text-slate-800">Cierre mensual</h2>
                    {!preview ? (
                        <Spinner />
                    ) : !preview.period ? (
                        <p className="text-sm text-slate-500">{preview.reason ?? "No hay períodos para cerrar."}</p>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="text-sm text-slate-700">
                                    <p>
                                        Próximo período: <span className="font-semibold">{formatPeriod(preview.period)}</span>
                                    </p>
                                    <p>
                                        {preview.lines.length} activos · Depreciación del período:{" "}
                                        <span className="font-semibold">{formatMoney(preview.totalAmount)}</span>
                                    </p>
                                    {!preview.canClose && <p className="text-amber-700">{preview.reason}</p>}
                                </div>
                                <div className="flex gap-2">
                                    {preview.lines.length > 0 && (
                                        <Button type="button" variant="ghost" onClick={() => setShowLines((value) => !value)}>
                                            {showLines ? "Ocultar detalle" : "Ver detalle"}
                                        </Button>
                                    )}
                                    {canClose && (
                                        <Button
                                            type="button"
                                            variant="primary"
                                            disabled={!preview.canClose || closing}
                                            onClick={() => setConfirmClose(true)}
                                        >
                                            Cerrar {formatPeriod(preview.period)}
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {confirmClose && (
                                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                                    <p>
                                        ¿Cerrar {formatPeriod(preview.period)}? Se registrará la depreciación de{" "}
                                        {preview.lines.length} activos ({formatMoney(preview.totalAmount)}) en el Kardex. Solo se
                                        podrá anular mientras sea el último cierre.
                                    </p>
                                    <div className="mt-3 flex justify-end gap-2">
                                        <Button type="button" variant="secondary" onClick={() => setConfirmClose(false)} disabled={closing}>
                                            Cancelar
                                        </Button>
                                        <Button type="button" variant="success" loading={closing} onClick={() => void handleClose()}>
                                            Sí, cerrar
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {showLines && (
                                <div className="max-h-72 overflow-y-auto rounded border border-slate-200">
                                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                <th className={TH}>Activo</th>
                                                <th className={`${TH} text-right`}>Cuota</th>
                                                <th className={`${TH} text-right`}>Acumulada</th>
                                                <th className={`${TH} text-right`}>Valor libro</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {preview.lines.map((line) => (
                                                <tr key={line.assetId}>
                                                    <td className="px-3 py-1.5">{line.tag}</td>
                                                    <td className="px-3 py-1.5 text-right">{formatMoney(line.amount)}</td>
                                                    <td className="px-3 py-1.5 text-right">{formatMoney(line.accumulated)}</td>
                                                    <td className="px-3 py-1.5 text-right">{formatMoney(line.bookValue)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}

                    {pendingVoid && (
                        <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
                            <p>
                                ¿Anular el cierre de {formatPeriod(pendingVoid.period)}? Se escribirá una reversa por cada asiento
                                ({formatMoney(pendingVoid.totalAmount)}) y el período quedará abierto de nuevo.
                            </p>
                            <div className="mt-3 flex justify-end gap-2">
                                <Button type="button" variant="secondary" onClick={() => setPendingVoid(null)} disabled={closing}>
                                    Cancelar
                                </Button>
                                <Button
                                    type="button"
                                    variant="primary"
                                    className="bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600"
                                    loading={closing}
                                    onClick={() => void handleVoid()}
                                >
                                    Sí, anular
                                </Button>
                            </div>
                        </div>
                    )}

                    <h3 className="text-sm font-semibold text-slate-700">Cierres anteriores</h3>
                    {runs.length === 0 ? (
                        <p className="text-sm text-slate-500">Todavía no hay cierres.</p>
                    ) : (
                        <>
                            {runsPager}
                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className={TH}>Período</th>
                                        <th className={TH}>Estado</th>
                                        <th className={`${TH} text-right`}>Activos</th>
                                        <th className={`${TH} text-right`}>Total</th>
                                        <th className="px-3 py-2" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {runs.map((run) => (
                                        <tr key={run.id}>
                                            <td className="px-3 py-2 text-slate-800">{formatPeriod(run.period)}</td>
                                            <td className="px-3 py-2">
                                                <span
                                                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                                        run.status === "CLOSED"
                                                            ? "bg-emerald-100 text-emerald-700"
                                                            : "bg-slate-200 text-slate-500"
                                                    }`}
                                                >
                                                    {run.status === "CLOSED" ? "Cerrado" : "Anulado"}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-right">{run.assetCount}</td>
                                            <td className="px-3 py-2 text-right">{formatMoney(run.totalAmount)}</td>
                                            <td className="px-3 py-2 text-right">
                                                {canVoid && run.id === lastClosedId && runsPage === 1 && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="px-2! py-1! text-xs text-rose-600 hover:bg-rose-100"
                                                        onClick={() => setPendingVoid(run)}
                                                    >
                                                        Anular
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {runsPager}
                        </>
                    )}
                </section>

                {/* ACTIVOS CAPITALIZADOS */}
                <section className="space-y-4">
                    <h2 className="text-base font-semibold text-slate-800">Activos capitalizados</h2>
                    <div className="max-w-sm">
                        <Input
                            placeholder="Buscar por tag o serie..."
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                setPage(1);
                            }}
                            className="bg-white"
                        />
                    </div>
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Spinner />
                        </div>
                    ) : records.length === 0 ? (
                        <EmptyState title="Sin activos capitalizados" description="Capitalice activos en «Capitalizacion»." />
                    ) : (
                        <>
                            {pager}
                            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="min-w-full divide-y divide-slate-200 text-sm">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className={TH}>Activo</th>
                                            <th className={TH}>Parámetros</th>
                                            <th className={`${TH} text-right`}>Costo</th>
                                            <th className={`${TH} text-right`}>Acumulada</th>
                                            <th className={`${TH} text-right`}>Valor libro</th>
                                            <th className={TH}>Estado</th>
                                            <th className="px-3 py-2" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {records.map((record) => (
                                            <tr
                                                key={record.assetId}
                                                className={selected?.assetId === record.assetId ? "bg-indigo-50" : undefined}
                                            >
                                                <td className="px-3 py-2">
                                                    <p className="font-medium text-slate-900">{record.tag}</p>
                                                    <p className="text-xs text-slate-500">{record.className ?? "-"}</p>
                                                </td>
                                                <td className="px-3 py-2 text-slate-600">
                                                    {record.usefulLifeMonths} meses ·{" "}
                                                    {record.depreciationMethod ? METHOD_LABEL[record.depreciationMethod] : "-"}
                                                    <p className="text-xs text-slate-500">
                                                        desde {formatPeriod(record.depreciationStartPeriod)}
                                                    </p>
                                                </td>
                                                <td className="px-3 py-2 text-right">{formatMoney(record.capitalizedCost)}</td>
                                                <td className="px-3 py-2 text-right">{formatMoney(record.accumulatedDepreciation)}</td>
                                                <td className="px-3 py-2 text-right font-medium">{formatMoney(record.bookValue)}</td>
                                                <td className="px-3 py-2 text-slate-600">{STAGE_LABEL[record.stage]}</td>
                                                <td className="px-3 py-2 text-right">
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="px-2! py-1! text-xs"
                                                        onClick={() => void select(record)}
                                                    >
                                                        Ver tabla
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {pager}
                        </>
                    )}

                    {selected && (
                        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
                            <h3 className="text-base font-semibold text-slate-800">
                                {selected.tag} · costo {formatMoney(selected.capitalizedCost)}
                            </h3>
                            <div className="grid grid-cols-1 items-end gap-3 min-[800px]:grid-cols-5">
                                <Field label="Vida útil (meses)" htmlFor="depLife">
                                    <Input
                                        id="depLife"
                                        type="number"
                                        min={1}
                                        value={life}
                                        disabled={!editable || !canUpdate}
                                        onChange={(e) => setLife(e.target.value)}
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                </Field>
                                <Field label="Método" htmlFor="depMethod">
                                    <Select
                                        id="depMethod"
                                        value={method}
                                        disabled={!editable || !canUpdate}
                                        onChange={(e) => setMethod(e.target.value as DepreciationMethod)}
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    >
                                        {(Object.keys(METHOD_LABEL) as DepreciationMethod[]).map((value) => (
                                            <option key={value} value={value}>
                                                {METHOD_LABEL[value]}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                                <Field label="Valor residual" htmlFor="depResidual">
                                    <Input
                                        id="depResidual"
                                        value={residual}
                                        inputMode="decimal"
                                        disabled={!editable || !canUpdate}
                                        onChange={(e) => setResidual(e.target.value)}
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                </Field>
                                <Field label="Inicio" htmlFor="depStart">
                                    <Input
                                        id="depStart"
                                        type="month"
                                        value={start}
                                        disabled={!editable || !canUpdate}
                                        onChange={(e) => setStart(e.target.value)}
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                </Field>
                                {editable && canUpdate && (
                                    <Button type="button" variant="success" loading={saving} onClick={() => void handleSaveParams()}>
                                        Guardar
                                    </Button>
                                )}
                            </div>
                            {!editable && (
                                <p className="text-xs text-slate-500">
                                    Los parámetros quedan fijos una vez que el activo tiene depreciación registrada.
                                </p>
                            )}

                            <div className="max-h-80 overflow-y-auto rounded border border-slate-200">
                                <table className="min-w-full divide-y divide-slate-200 text-sm">
                                    <thead className="sticky top-0 bg-slate-50">
                                        <tr>
                                            <th className={TH}>#</th>
                                            <th className={TH}>Período</th>
                                            <th className={`${TH} text-right`}>Cuota</th>
                                            <th className={`${TH} text-right`}>Acumulada</th>
                                            <th className={`${TH} text-right`}>Valor libro</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {schedule.map((row) => (
                                            <tr key={row.installment}>
                                                <td className="px-3 py-1.5 text-slate-500">{row.installment}</td>
                                                <td className="px-3 py-1.5">{formatPeriod(row.period)}</td>
                                                <td className="px-3 py-1.5 text-right">{formatMoney(row.amount)}</td>
                                                <td className="px-3 py-1.5 text-right">{formatMoney(row.accumulated)}</td>
                                                <td className="px-3 py-1.5 text-right">{formatMoney(row.bookValue)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
