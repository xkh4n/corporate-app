import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, EmptyState, Input, Select, Spinner } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { assetAccountingService } from "../../services/assetAccountingService";
import type {
    AccountingClass,
    AccountingRecord,
    Classification,
    PendingAccountingAsset,
} from "../../types/assetAccounting";
import { CLASSIFICATION_LABEL, STAGE_LABEL, formatMoney } from "./accountingLabels";
import { Pager } from "./Pager";

// Paso 1 del ciclo contable (plan 007): clasificar cada activo como activo
// fijo, gasto o inventario. "Clasificados" permite reclasificar mientras el
// activo no este capitalizado. La pantalla se ve con :read; clasificar exige
// asset-accounting:update. El umbral y las clases vienen de la politica
// contable (asset-accounting-policy:read, incluido en el permiso de pantalla).
const REQUIRED_PERMISSIONS = ["asset-accounting:read", "asset-accounting-policy:read"] as const;
const PAGE_SIZE = 20;
const TH = "px-3 py-2 text-left font-semibold text-slate-600";

type Tab = "pending" | "classified";
type RowAsset = PendingAccountingAsset & Partial<Pick<AccountingRecord, "classification" | "classId" | "stage">>;

interface Draft {
    classification: Classification | "";
    classId: string;
    confirmBelow: boolean;
}

export default function ClasificacionContable() {
    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <ClassificationContent />
        </RequirePermissions>
    );
}

function ClassificationContent() {
    const navigate = useNavigate();
    const { can } = useAuth();
    const canUpdate = can("asset-accounting:update");

    const [tab, setTab] = useState<Tab>("pending");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<RowAsset[]>([]);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);

    const [classes, setClasses] = useState<AccountingClass[]>([]);
    const [threshold, setThreshold] = useState(0);
    const [drafts, setDrafts] = useState<Record<number, Draft>>({});
    const [savingId, setSavingId] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [policy, activeClasses] = await Promise.all([
                    assetAccountingService.getPolicy(),
                    assetAccountingService.listClasses(),
                ]);
                if (cancelled) return;
                setThreshold(Number(policy.capitalizationThreshold));
                setClasses(activeClasses);
            } catch (error) {
                handleError(error, navigate);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [navigate]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = { page, limit: PAGE_SIZE, search: search.trim() || undefined };
            const res =
                tab === "pending"
                    ? await assetAccountingService.listPending(params)
                    : await assetAccountingService.list({ ...params, status: "CLASSIFIED,COSTED" });
            setRows(res.items);
            setTotalPages(res.pagination.totalPages);
            setTotalItems(res.pagination.totalItems);
            setDrafts(
                Object.fromEntries(
                    res.items.map((item: RowAsset) => [
                        item.assetId,
                        {
                            classification: item.classification ?? "",
                            classId: item.classId ? String(item.classId) : "",
                            confirmBelow: false,
                        },
                    ]),
                ),
            );
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
    }

    function updateDraft(assetId: number, patch: Partial<Draft>) {
        setDrafts((current) => ({ ...current, [assetId]: { ...current[assetId]!, ...patch } }));
    }

    function isBelowThreshold(row: RowAsset): boolean {
        return threshold > 0 && row.value !== null && Number(row.value) < threshold;
    }

    async function handleClassify(row: RowAsset) {
        const draft = drafts[row.assetId];
        if (!draft?.classification) return;
        try {
            setSavingId(row.assetId);
            await assetAccountingService.classify(row.assetId, {
                classification: draft.classification,
                ...(draft.classification === "FIXED_ASSET" ? { classId: Number(draft.classId) } : {}),
                ...(draft.confirmBelow ? { belowThresholdConfirmed: true } : {}),
            });
            showSuccessToast(`Activo ${row.tag} clasificado como ${CLASSIFICATION_LABEL[draft.classification]}`);
            await load();
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setSavingId(null);
        }
    }

    const pager = (
        <Pager page={page} totalPages={totalPages} totalItems={totalItems} noun="activos" onChange={setPage} />
    );

    return (
        <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-2 text-center text-gray-600">Clasificación Contable</h1>
            <p className="mb-6 text-sm text-slate-600 text-center max-w-3xl">
                Determine si cada activo es activo fijo (se capitaliza y deprecia), gasto o inventario.
                {threshold > 0 && ` Umbral de capitalización: ${formatMoney(threshold)}.`}
            </p>

            <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex rounded-lg border border-slate-300 bg-white p-1 text-sm">
                        {(["pending", "classified"] as const).map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => changeTab(value)}
                                className={`rounded-md px-3 py-1 ${tab === value ? "bg-indigo-600 text-white" : "text-slate-700"}`}
                            >
                                {value === "pending" ? "Pendientes" : "Clasificados (editables)"}
                            </button>
                        ))}
                    </div>
                    <div className="max-w-sm flex-1">
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
                ) : rows.length === 0 ? (
                    <EmptyState
                        title={tab === "pending" ? "Sin activos pendientes" : "Sin activos clasificados editables"}
                        description="No hay activos en esta vista."
                    />
                ) : (
                    <>
                        {pager}
                        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className={TH}>Activo</th>
                                        <th className={TH}>Producto</th>
                                        <th className={TH}>Centro de costo</th>
                                        <th className={`${TH} text-right`}>Valor</th>
                                        {tab === "classified" && <th className={TH}>Actual</th>}
                                        <th className={TH}>Clasificación</th>
                                        <th className={TH}>Clase contable</th>
                                        <th className="px-3 py-2" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {rows.map((row) => {
                                        const draft = drafts[row.assetId];
                                        const below = isBelowThreshold(row);
                                        const needsConfirm = draft?.classification === "FIXED_ASSET" && below;
                                        const ready =
                                            !!draft?.classification &&
                                            (draft.classification !== "FIXED_ASSET" || !!draft.classId) &&
                                            (!needsConfirm || draft.confirmBelow);
                                        return (
                                            <tr key={row.assetId} className="align-top">
                                                <td className="px-3 py-2">
                                                    <p className="font-medium text-slate-900">{row.tag}</p>
                                                    <p className="text-xs text-slate-500">{row.serialNumber ?? "Sin serie"}</p>
                                                </td>
                                                <td className="px-3 py-2 text-slate-600">{row.productName ?? "-"}</td>
                                                <td className="px-3 py-2 text-slate-600">{row.costCenterName ?? "-"}</td>
                                                <td className="px-3 py-2 text-right text-slate-700">
                                                    {row.value === null ? (
                                                        <span className="text-xs text-amber-700">Sin valor</span>
                                                    ) : (
                                                        formatMoney(row.value)
                                                    )}
                                                    {below && <p className="text-xs text-amber-700">Bajo el umbral</p>}
                                                </td>
                                                {tab === "classified" && (
                                                    <td className="px-3 py-2 text-slate-600">
                                                        {row.classification ? CLASSIFICATION_LABEL[row.classification] : "-"}
                                                        {row.stage && (
                                                            <p className="text-xs text-slate-500">{STAGE_LABEL[row.stage]}</p>
                                                        )}
                                                    </td>
                                                )}
                                                <td className="px-3 py-2">
                                                    <Select
                                                        aria-label={`Clasificación de ${row.tag}`}
                                                        value={draft?.classification ?? ""}
                                                        disabled={!canUpdate}
                                                        onChange={(e) =>
                                                            updateDraft(row.assetId, {
                                                                classification: e.target.value as Classification | "",
                                                                confirmBelow: false,
                                                            })
                                                        }
                                                        className="bg-zinc-100 focus:bg-indigo-100"
                                                    >
                                                        <option value="">Seleccione</option>
                                                        {(Object.keys(CLASSIFICATION_LABEL) as Classification[]).map((value) => (
                                                            <option key={value} value={value}>
                                                                {CLASSIFICATION_LABEL[value]}
                                                            </option>
                                                        ))}
                                                    </Select>
                                                    {needsConfirm && (
                                                        <label className="mt-1 flex items-center gap-1 text-xs text-amber-800">
                                                            <input
                                                                type="checkbox"
                                                                checked={draft.confirmBelow}
                                                                onChange={(e) =>
                                                                    updateDraft(row.assetId, { confirmBelow: e.target.checked })
                                                                }
                                                            />
                                                            Capitalizar igual bajo el umbral
                                                        </label>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {draft?.classification === "FIXED_ASSET" ? (
                                                        <Select
                                                            aria-label={`Clase contable de ${row.tag}`}
                                                            value={draft.classId}
                                                            disabled={!canUpdate}
                                                            onChange={(e) => updateDraft(row.assetId, { classId: e.target.value })}
                                                            className="bg-zinc-100 focus:bg-indigo-100"
                                                        >
                                                            <option value="">Seleccione la clase</option>
                                                            {classes.map((accountingClass) => (
                                                                <option key={accountingClass.id} value={accountingClass.id}>
                                                                    {accountingClass.name} ({accountingClass.usefulLifeMonths} meses)
                                                                </option>
                                                            ))}
                                                        </Select>
                                                    ) : (
                                                        <span className="text-xs text-slate-400">No aplica</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-right">
                                                    {canUpdate && (
                                                        <Button
                                                            type="button"
                                                            variant="success"
                                                            className="px-3! py-1! text-xs"
                                                            disabled={!ready}
                                                            loading={savingId === row.assetId}
                                                            onClick={() => void handleClassify(row)}
                                                        >
                                                            {tab === "pending" ? "Clasificar" : "Reclasificar"}
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {pager}
                    </>
                )}
            </div>
        </div>
    );
}
