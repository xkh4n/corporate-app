import { useCallback, useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, EmptyState, Field, Input, Spinner } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { assetAccountingService } from "../../services/assetAccountingService";
import type { AccountingRecord, AttributableCost } from "../../types/assetAccounting";
import { STAGE_LABEL, formatMoney, parseAmount } from "./accountingLabels";
import { Pager } from "./Pager";

// Paso 2 (plan 007): costo = valor de adquisicion + costos directamente
// atribuibles (flete, instalacion, impuestos no recuperables, etc.). Solo
// activos fijos todavia no capitalizados. Tocar un costo invalida el costo ya
// fijado: hay que volver a fijarlo antes de capitalizar.
const REQUIRED_PERMISSIONS = ["asset-accounting:read"] as const;
const PAGE_SIZE = 20;
const TH = "whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-600";

export default function DeterminarCosto() {
    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <CostContent />
        </RequirePermissions>
    );
}

function CostContent() {
    const navigate = useNavigate();
    const { can } = useAuth();
    const canUpdate = can("asset-accounting:update");

    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [records, setRecords] = useState<AccountingRecord[]>([]);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);

    const [selected, setSelected] = useState<AccountingRecord | null>(null);
    const [costs, setCosts] = useState<AttributableCost[]>([]);
    const [loadingCosts, setLoadingCosts] = useState(false);
    const [concept, setConcept] = useState("");
    const [amount, setAmount] = useState("");
    const [documentRef, setDocumentRef] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await assetAccountingService.list({
                page,
                limit: PAGE_SIZE,
                search: search.trim() || undefined,
                status: "CLASSIFIED,COSTED",
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
        void load();
    }, [load]);

    async function select(record: AccountingRecord) {
        setSelected(record);
        setLoadingCosts(true);
        try {
            setCosts(await assetAccountingService.listCosts(record.assetId));
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setLoadingCosts(false);
        }
    }

    async function refreshSelected(assetId: number) {
        const [record, list] = await Promise.all([
            assetAccountingService.get(assetId),
            assetAccountingService.listCosts(assetId),
        ]);
        setSelected(record);
        setCosts(list);
        setRecords((current) => current.map((item) => (item.assetId === assetId ? record : item)));
    }

    async function handleAddCost(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!selected) return;
        try {
            const value = parseAmount(amount);
            if (concept.trim().length < 2) throw createValidationError("Indique el concepto del costo");
            if (value === null || value < 0.01) throw createValidationError("El monto debe ser mayor a 0");
            setBusy(true);
            await assetAccountingService.addCost(selected.assetId, {
                concept: concept.trim(),
                amount: value,
                ...(documentRef.trim() ? { documentRef: documentRef.trim() } : {}),
            });
            setConcept("");
            setAmount("");
            setDocumentRef("");
            await refreshSelected(selected.assetId);
            showSuccessToast("Costo atribuible agregado");
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setBusy(false);
        }
    }

    async function handleRemove(cost: AttributableCost) {
        if (!selected) return;
        try {
            setBusy(true);
            await assetAccountingService.removeCost(selected.assetId, cost.id);
            await refreshSelected(selected.assetId);
            showSuccessToast(`Costo «${cost.concept}» quitado`);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setBusy(false);
        }
    }

    async function handleConfirm() {
        if (!selected) return;
        try {
            setBusy(true);
            const record = await assetAccountingService.confirmCost(selected.assetId);
            setSelected(record);
            setRecords((current) => current.map((item) => (item.assetId === record.assetId ? record : item)));
            showSuccessToast(`Costo fijado en ${formatMoney(record.capitalizedCost)}: ya se puede capitalizar`);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setBusy(false);
        }
    }

    const pager = <Pager page={page} totalPages={totalPages} totalItems={totalItems} noun="activos" onChange={setPage} />;
    const projected = selected?.value !== null && selected ? Number(selected.value) + Number(selected.attributableTotal) : null;

    return (
        <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-2 text-center text-gray-600">Determinar Costo</h1>
            <p className="mb-6 text-sm text-slate-600 text-center max-w-3xl">
                Costo capitalizable = valor de adquisición + costos directamente atribuibles, según la política contable.
            </p>

            <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8 space-y-4">
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
                    <EmptyState
                        title="Sin activos fijos por costear"
                        description="Clasifique primero los activos como activo fijo en «Clasificación Contable»."
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
                                        <th className={`${TH} text-right`}>Adquisición</th>
                                        <th className={`${TH} text-right`}>Atribuibles</th>
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
                                            <td className="min-w-[10rem] px-3 py-2">
                                                <p className="whitespace-nowrap font-medium text-slate-900">{record.tag}</p>
                                                <p className="text-xs text-slate-500">{record.productName ?? "-"}</p>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-slate-600">{record.className ?? "-"}</td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">
                                                {record.value === null ? (
                                                    <span className="text-xs text-amber-700">Sin valor</span>
                                                ) : (
                                                    formatMoney(record.value)
                                                )}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">
                                                {formatMoney(record.attributableTotal)}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-slate-600">{STAGE_LABEL[record.stage]}</td>
                                            <td className="px-3 py-2 text-right">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className="whitespace-nowrap px-3! py-2! text-xs sm:px-2! sm:py-1!"
                                                    onClick={() => void select(record)}
                                                >
                                                    Ver costos
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
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h2 className="min-w-0 break-words text-base font-semibold text-slate-800">
                                {selected.tag} · {selected.className}
                            </h2>
                            <span className="text-xs text-slate-500">{STAGE_LABEL[selected.stage]}</span>
                        </div>

                        {selected.value === null && (
                            <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                                Este activo no tiene valor de adquisición. Valorícelo primero en «Valorización de Activos».
                            </p>
                        )}

                        <div className="grid grid-cols-1 gap-3 text-sm min-[800px]:grid-cols-3">
                            <div className="rounded bg-slate-50 p-3">
                                <p className="text-xs text-slate-500">Valor de adquisición</p>
                                <p className="font-semibold text-slate-800">{formatMoney(selected.value)}</p>
                            </div>
                            <div className="rounded bg-slate-50 p-3">
                                <p className="text-xs text-slate-500">Costos atribuibles</p>
                                <p className="font-semibold text-slate-800">{formatMoney(selected.attributableTotal)}</p>
                            </div>
                            <div className="rounded bg-emerald-50 p-3">
                                <p className="text-xs text-emerald-700">Costo capitalizable</p>
                                <p className="font-semibold text-emerald-900">{formatMoney(projected)}</p>
                            </div>
                        </div>

                        {loadingCosts ? (
                            <div className="flex justify-center py-6">
                                <Spinner />
                            </div>
                        ) : costs.length === 0 ? (
                            <p className="text-sm text-slate-500">Sin costos atribuibles registrados.</p>
                        ) : (
                            <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className={TH}>Concepto</th>
                                        <th className={TH}>Documento</th>
                                        <th className={`${TH} text-right`}>Monto</th>
                                        <th className="px-3 py-2" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {costs.map((cost) => (
                                        <tr key={cost.id}>
                                            <td className="min-w-[10rem] px-3 py-2 text-slate-800">{cost.concept}</td>
                                            <td className="whitespace-nowrap px-3 py-2 text-slate-600">{cost.documentRef ?? "-"}</td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right text-slate-800">{formatMoney(cost.amount)}</td>
                                            <td className="px-3 py-2 text-right">
                                                {canUpdate && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="whitespace-nowrap px-3! py-2! text-xs sm:px-2! sm:py-1! text-rose-600 hover:bg-rose-100"
                                                        disabled={busy}
                                                        onClick={() => void handleRemove(cost)}
                                                    >
                                                        Quitar
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            </div>
                        )}

                        {canUpdate && (
                            <form
                                onSubmit={(event) => void handleAddCost(event)}
                                className="grid grid-cols-1 items-end gap-3 min-[800px]:grid-cols-4"
                            >
                                <Field label="Concepto" htmlFor="costConcept">
                                    <Input
                                        id="costConcept"
                                        value={concept}
                                        maxLength={150}
                                        onChange={(e) => setConcept(e.target.value)}
                                        placeholder="ej. Flete, instalación"
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                </Field>
                                <Field label="Monto" htmlFor="costAmount">
                                    <Input
                                        id="costAmount"
                                        value={amount}
                                        inputMode="decimal"
                                        onChange={(e) => setAmount(e.target.value)}
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                </Field>
                                <Field label="Documento (opcional)" htmlFor="costDocument">
                                    <Input
                                        id="costDocument"
                                        value={documentRef}
                                        maxLength={50}
                                        onChange={(e) => setDocumentRef(e.target.value)}
                                        placeholder="ej. Factura 1234"
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                </Field>
                                <Button type="submit" variant="secondary" loading={busy}>
                                    Agregar costo
                                </Button>
                            </form>
                        )}

                        {canUpdate && (
                            <div className="flex justify-end">
                                <Button
                                    type="button"
                                    variant="success"
                                    className="w-full sm:w-auto"
                                    disabled={busy || selected.value === null}
                                    onClick={() => void handleConfirm()}
                                >
                                    {selected.stage === "COSTED" ? "Volver a fijar costo" : "Fijar costo"}
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
