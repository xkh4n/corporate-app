import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, EmptyState, Field, Input, Spinner } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { assetAccountingService } from "../../services/assetAccountingService";
import type { AccountingRecord } from "../../types/assetAccounting";
import { METHOD_LABEL, PERIOD_PATTERN, STAGE_LABEL, formatMoney, formatPeriod } from "./accountingLabels";
import { Pager } from "./Pager";

// Paso 3 (plan 007): dar de alta el activo en el registro de activos fijos.
// Escribe el asiento CAPITALIZATION (costos atribuibles) en el Kardex y fija
// el inicio de la depreciacion. Capitalizar exige asset-capitalization:create.
const REQUIRED_PERMISSIONS = ["asset-accounting:read"] as const;
const PAGE_SIZE = 20;
const TH = "whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-600";

type Tab = "ready" | "capitalized";

function nextMonth(): string {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

export default function Capitalizacion() {
    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <CapitalizationContent />
        </RequirePermissions>
    );
}

function CapitalizationContent() {
    const navigate = useNavigate();
    const { can } = useAuth();
    const canCapitalize = can("asset-capitalization:create");

    const [tab, setTab] = useState<Tab>("ready");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [records, setRecords] = useState<AccountingRecord[]>([]);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);

    const [selected, setSelected] = useState<AccountingRecord | null>(null);
    const [startPeriod, setStartPeriod] = useState(nextMonth());
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await assetAccountingService.list({
                page,
                limit: PAGE_SIZE,
                search: search.trim() || undefined,
                status: tab === "ready" ? "COSTED" : "CAPITALIZED,DEPRECIATING,FULLY_DEPRECIATED",
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
    }, [tab, page, search, navigate]);

    useEffect(() => {
        void load();
    }, [load]);

    function changeTab(next: Tab) {
        setTab(next);
        setPage(1);
        setSelected(null);
    }

    async function handleCapitalize() {
        if (!selected) return;
        try {
            if (!PERIOD_PATTERN.test(startPeriod)) throw createValidationError("Indique el mes de inicio de la depreciación");
            setBusy(true);
            const record = await assetAccountingService.capitalize(selected.assetId, { depreciationStartPeriod: startPeriod });
            showSuccessToast(
                `Activo ${record.tag} capitalizado por ${formatMoney(record.capitalizedCost)}; deprecia desde ${formatPeriod(
                    record.depreciationStartPeriod,
                )}`,
            );
            setSelected(null);
            await load();
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setBusy(false);
        }
    }

    const pager = <Pager page={page} totalPages={totalPages} totalItems={totalItems} noun="activos" onChange={setPage} />;

    return (
        <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-2 text-center text-gray-600">Capitalización</h1>
            <p className="mb-6 text-sm text-slate-600 text-center max-w-3xl">
                Da de alta el activo en el registro de activos fijos con su costo fijado y el mes en que empieza a depreciarse.
            </p>

            <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                    <div className="flex max-w-full self-start overflow-x-auto rounded-lg border border-slate-300 bg-white p-1 text-sm sm:self-auto">
                        {(["ready", "capitalized"] as const).map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => changeTab(value)}
                                className={`shrink-0 whitespace-nowrap rounded-md px-3 py-2 sm:py-1 ${tab === value ? "bg-indigo-600 text-white" : "text-slate-700"}`}
                            >
                                {value === "ready" ? "Por capitalizar" : "Capitalizados"}
                            </button>
                        ))}
                    </div>
                    <div className="w-full sm:max-w-sm sm:flex-1">
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
                </div>

                {loading ? (
                    <div className="flex justify-center py-12">
                        <Spinner />
                    </div>
                ) : records.length === 0 ? (
                    <EmptyState
                        title={tab === "ready" ? "Sin activos por capitalizar" : "Sin activos capitalizados"}
                        description={tab === "ready" ? "Fije primero el costo en «Determinar Costo»." : "Todavía no hay activos capitalizados."}
                    />
                ) : (
                    <>
                        {pager}
                        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className={TH}>Activo</th>
                                        <th className={TH}>Clase</th>
                                        <th className={`${TH} text-right`}>Costo capitalizado</th>
                                        {tab === "capitalized" && <th className={`${TH} text-right`}>Valor libro</th>}
                                        <th className={TH}>{tab === "ready" ? "Depreciación" : "Estado"}</th>
                                        {tab === "ready" && <th className="px-3 py-2" />}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {records.map((record) => (
                                        <tr
                                            key={record.assetId}
                                            className={selected?.assetId === record.assetId ? "bg-indigo-50" : undefined}
                                        >
                                            <td className="min-w-[10rem] px-3 py-2">
                                                <p className="whitespace-nowrap font-medium text-slate-900">{record.tag}</p>
                                                <p className="text-xs text-slate-500">{record.productName ?? "-"}</p>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-slate-600">{record.className ?? "-"}</td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right text-slate-800">
                                                {formatMoney(record.capitalizedCost)}
                                            </td>
                                            {tab === "capitalized" && (
                                                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-800">{formatMoney(record.bookValue)}</td>
                                            )}
                                            <td className="min-w-[10rem] px-3 py-2 text-slate-600">
                                                {tab === "ready"
                                                    ? `${record.usefulLifeMonths ?? "-"} meses, ${
                                                          record.depreciationMethod ? METHOD_LABEL[record.depreciationMethod] : "-"
                                                      }`
                                                    : `${STAGE_LABEL[record.stage]} desde ${formatPeriod(record.depreciationStartPeriod)}`}
                                            </td>
                                            {tab === "ready" && (
                                                <td className="px-3 py-2 text-right">
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="whitespace-nowrap px-3! py-2! text-xs sm:px-2! sm:py-1!"
                                                        onClick={() => {
                                                            setSelected(record);
                                                            setStartPeriod(nextMonth());
                                                        }}
                                                    >
                                                        Revisar
                                                    </Button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {pager}
                    </>
                )}

                {selected && tab === "ready" && (
                    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
                        <h2 className="break-words text-base font-semibold text-slate-800">
                            Capitalizar {selected.tag} · {selected.className}
                        </h2>
                        <dl className="grid grid-cols-2 gap-3 text-sm min-[800px]:grid-cols-3">
                            <div className="rounded bg-slate-50 p-3">
                                <dt className="text-xs text-slate-500">Adquisición</dt>
                                <dd className="font-semibold text-slate-800">{formatMoney(selected.acquisitionCost)}</dd>
                            </div>
                            <div className="rounded bg-slate-50 p-3">
                                <dt className="text-xs text-slate-500">Costos atribuibles</dt>
                                <dd className="font-semibold text-slate-800">{formatMoney(selected.attributableTotal)}</dd>
                            </div>
                            <div className="rounded bg-emerald-50 p-3">
                                <dt className="text-xs text-emerald-700">Costo capitalizado</dt>
                                <dd className="font-semibold text-emerald-900">{formatMoney(selected.capitalizedCost)}</dd>
                            </div>
                            <div className="rounded bg-slate-50 p-3">
                                <dt className="text-xs text-slate-500">Vida útil</dt>
                                <dd className="font-semibold text-slate-800">{selected.usefulLifeMonths} meses</dd>
                            </div>
                            <div className="rounded bg-slate-50 p-3">
                                <dt className="text-xs text-slate-500">Método</dt>
                                <dd className="font-semibold text-slate-800">
                                    {selected.depreciationMethod ? METHOD_LABEL[selected.depreciationMethod] : "-"}
                                </dd>
                            </div>
                            <div className="rounded bg-slate-50 p-3">
                                <dt className="text-xs text-slate-500">Valor residual</dt>
                                <dd className="font-semibold text-slate-800">{formatMoney(selected.residualValue)}</dd>
                            </div>
                        </dl>
                        <p className="text-xs text-slate-500">
                            La vida útil, el método y el valor residual se ajustan en «Depreciación» mientras no se haya cerrado ningún mes.
                        </p>

                        {canCapitalize ? (
                            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                                <Field label="Inicio de la depreciación" htmlFor="startPeriod">
                                    <Input
                                        id="startPeriod"
                                        type="month"
                                        value={startPeriod}
                                        onChange={(e) => setStartPeriod(e.target.value)}
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                </Field>
                                <Button type="button" variant="success" className="w-full sm:w-auto" loading={busy} onClick={() => void handleCapitalize()}>
                                    Capitalizar
                                </Button>
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500">Capitalizar requiere el permiso «Capitalizar activos fijos».</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
