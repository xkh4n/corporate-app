import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, EmptyState, Input, Spinner } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { assetWriteOffService } from "../../services/assetWriteOffService";
import type { EligibleWriteOffAsset, WriteOffSummary } from "../../types/assetWriteOff";
import { CLASSIFICATION_LABEL, STAGE_LABEL, formatMoney } from "./accountingLabels";
import { Pager } from "./Pager";
import { WriteOffPanel } from "./WriteOffPanel";

// Baja contable (plan 008): cierra el ciclo contable de activos ya dados de
// baja operativamente. Se arma un borrador con fotos por activo y un
// certificado notarial; confirmar (asset-write-offs:approve) es definitivo.
// Plan 013: individual (1 activo) o por lote (todos los pendientes), con 1
// certificado; la foto de cada activo ya viene de Dar de Baja Activos.
const REQUIRED_PERMISSIONS = ["asset-write-offs:read"] as const;
const PAGE_SIZE = 20;
const TH = "whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-600";

type Tab = "new" | "drafts" | "history";

const TAB_LABEL: Record<Tab, string> = {
    new: "Nueva baja",
    drafts: "Borradores",
    history: "Historial",
};

export default function BajaContable() {
    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <WriteOffContent />
        </RequirePermissions>
    );
}

function WriteOffContent() {
    const { can } = useAuth();
    const canCreate = can("asset-write-offs:create");
    const tabs: Tab[] = canCreate ? ["new", "drafts", "history"] : ["drafts", "history"];

    const [tab, setTab] = useState<Tab>(tabs[0]!);
    const [openId, setOpenId] = useState<number | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    function changeTab(next: Tab) {
        setTab(next);
        setOpenId(null);
    }

    function openWriteOff(id: number, nextTab: Tab) {
        setTab(nextTab);
        setOpenId(id);
    }

    function handlePanelChanged(closed: boolean) {
        if (closed) setOpenId(null);
        setReloadKey((key) => key + 1);
    }

    return (
        <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-2 text-center text-gray-600">Baja Contable</h1>
            <p className="mb-6 text-sm text-slate-600 text-center max-w-3xl">
                Registra la baja contable de los activos pendientes (dados de baja en Dar de Baja Activos), de a uno o por
                lote, con un certificado notarial por baja. Cada activo usa la foto tomada al darlo de baja. Una baja
                confirmada es definitiva y deja el activo «De baja».
            </p>

            <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8 space-y-4">
                <div className="flex max-w-full overflow-x-auto rounded-lg border border-slate-300 bg-white p-1 text-sm w-fit">
                    {tabs.map((value) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => changeTab(value)}
                            className={`shrink-0 whitespace-nowrap rounded-md px-3 py-2 sm:py-1 ${tab === value ? "bg-indigo-600 text-white" : "text-slate-700"}`}
                        >
                            {TAB_LABEL[value]}
                        </button>
                    ))}
                </div>

                {openId !== null ? (
                    <WriteOffPanel
                        key={openId}
                        id={openId}
                        onBack={() => setOpenId(null)}
                        onChanged={handlePanelChanged}
                    />
                ) : tab === "new" ? (
                    <EligibleAssets onCreated={(id) => openWriteOff(id, "drafts")} />
                ) : (
                    <WriteOffList
                        key={`${tab}-${reloadKey}`}
                        status={tab === "drafts" ? "DRAFT" : "CONFIRMED"}
                        onOpen={(id) => setOpenId(id)}
                    />
                )}
            </div>
        </div>
    );
}

function EligibleAssets({ onCreated }: { onCreated: (id: number) => void }) {
    const navigate = useNavigate();
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [assets, setAssets] = useState<EligibleWriteOffAsset[]>([]);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [selected, setSelected] = useState<Map<number, EligibleWriteOffAsset>>(new Map());
    const [creating, setCreating] = useState<"selection" | "all" | number | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await assetWriteOffService.listEligible({
                page,
                limit: PAGE_SIZE,
                search: search.trim() || undefined,
            });
            setAssets(res.items);
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

    function toggle(asset: EligibleWriteOffAsset) {
        setSelected((current) => {
            const next = new Map(current);
            if (next.has(asset.assetId)) next.delete(asset.assetId);
            else next.set(asset.assetId, asset);
            return next;
        });
    }

    // Seleccion, un activo (baja individual) o todos los pendientes (baja por lote).
    async function handleCreate(kind: "selection" | "all" | number) {
        setCreating(kind);
        try {
            const created =
                kind === "all"
                    ? await assetWriteOffService.createAllPending()
                    : await assetWriteOffService.create(kind === "selection" ? [...selected.keys()] : [kind]);
            const skipped = kind === "all" ? totalItems - created.lines.length : 0;
            showSuccessToast(
                `Borrador de baja #${created.id} creado con ${created.lines.length} activo(s)` +
                    (skipped > 0 ? `; ${skipped} ya estaban en otro borrador o superan el tope de la baja` : ""),
            );
            setSelected(new Map());
            onCreated(created.id);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setCreating(null);
        }
    }

    const pager = <Pager page={page} totalPages={totalPages} totalItems={totalItems} noun="activos" onChange={setPage} />;
    const selectedTotal = [...selected.values()].reduce((sum, asset) => sum + Number(asset.bookValue), 0);

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
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
                <div className="flex flex-col gap-2 text-sm text-slate-700 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                    <span>
                        {selected.size} seleccionado(s) · valor libro {formatMoney(selectedTotal)}
                    </span>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={selected.size === 0 || creating !== null}
                        loading={creating === "selection"}
                        onClick={() => void handleCreate("selection")}
                    >
                        Baja de los seleccionados
                    </Button>
                    <Button
                        type="button"
                        variant="success"
                        disabled={totalItems === 0 || creating !== null}
                        loading={creating === "all"}
                        onClick={() => void handleCreate("all")}
                    >
                        Baja por lote (todos los pendientes: {totalItems})
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Spinner />
                </div>
            ) : assets.length === 0 ? (
                <EmptyState
                    title="Sin activos pendientes de baja contable"
                    description="Aparecen los activos clasificados contablemente y dados de baja en Dar de Baja Activos (estado «Pendiente de baja contable»)."
                />
            ) : (
                <>
                    {pager}
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-3 py-2" />
                                    <th className={TH}>Activo</th>
                                    <th className={TH}>Centro de costo</th>
                                    <th className={TH}>Clasificación</th>
                                    <th className={TH}>Etapa</th>
                                    <th className={`${TH} text-right`}>Valor libro</th>
                                    <th className="px-3 py-2" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {assets.map((asset) => (
                                    <tr
                                        key={asset.assetId}
                                        className={`cursor-pointer ${selected.has(asset.assetId) ? "bg-indigo-50" : ""}`}
                                        onClick={() => toggle(asset)}
                                    >
                                        <td className="px-3 py-2">
                                            <input
                                                type="checkbox"
                                                className="h-5 w-5"
                                                checked={selected.has(asset.assetId)}
                                                onChange={() => toggle(asset)}
                                                onClick={(e) => e.stopPropagation()}
                                                aria-label={`Seleccionar ${asset.tag}`}
                                            />
                                        </td>
                                        <td className="min-w-[10rem] px-3 py-2">
                                            <p className="whitespace-nowrap font-medium text-slate-900">{asset.tag}</p>
                                            <p className="text-xs text-slate-500">{asset.productName ?? asset.serialNumber ?? "-"}</p>
                                        </td>
                                        <td className="min-w-[8rem] px-3 py-2 text-slate-600">{asset.costCenterName ?? "-"}</td>
                                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{CLASSIFICATION_LABEL[asset.classification]}</td>
                                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{STAGE_LABEL[asset.stage]}</td>
                                        <td className="whitespace-nowrap px-3 py-2 text-right text-slate-800">{formatMoney(asset.bookValue)}</td>
                                        <td className="px-3 py-2 text-right">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="whitespace-nowrap px-3! py-2! text-xs sm:px-2! sm:py-1!"
                                                disabled={creating !== null}
                                                loading={creating === asset.assetId}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleCreate(asset.assetId);
                                                }}
                                            >
                                                Baja individual
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
        </div>
    );
}

function WriteOffList({ status, onOpen }: { status: "DRAFT" | "CONFIRMED"; onOpen: (id: number) => void }) {
    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<WriteOffSummary[]>([]);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await assetWriteOffService.list({ page, limit: PAGE_SIZE, status });
            setItems(res.items);
            setTotalPages(res.pagination.totalPages);
            setTotalItems(res.pagination.totalItems);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setLoading(false);
        }
    }, [page, status, navigate]);

    useEffect(() => {
        void load();
    }, [load]);

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Spinner />
            </div>
        );
    }
    if (items.length === 0) {
        return (
            <EmptyState
                title={status === "DRAFT" ? "Sin borradores" : "Sin bajas confirmadas"}
                description={
                    status === "DRAFT" ? "Cree una baja desde «Nueva baja»." : "Todavía no se ha confirmado ninguna baja contable."
                }
            />
        );
    }

    const pager = <Pager page={page} totalPages={totalPages} totalItems={totalItems} noun="bajas" onChange={setPage} />;
    return (
        <div className="space-y-4">
            {pager}
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className={TH}>Baja</th>
                            <th className={TH}>Fecha</th>
                            <th className={TH}>Motivo</th>
                            <th className={`${TH} text-right`}>Activos</th>
                            {status === "CONFIRMED" && <th className={`${TH} text-right`}>Valor libro dado de baja</th>}
                            <th className="px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {items.map((item) => (
                            <tr key={item.id}>
                                <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">#{item.id}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{item.writeOffDate ?? "-"}</td>
                                <td className="min-w-[12rem] px-3 py-2 text-slate-600">{item.reason ?? "-"}</td>
                                <td className="px-3 py-2 text-right text-slate-800">
                                    {status === "CONFIRMED" ? item.assetCount : item.lineCount}
                                </td>
                                {status === "CONFIRMED" && (
                                    <td className="whitespace-nowrap px-3 py-2 text-right text-slate-800">{formatMoney(item.totalBookValue)}</td>
                                )}
                                <td className="px-3 py-2 text-right">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="whitespace-nowrap px-3! py-2! text-xs sm:px-2! sm:py-1!"
                                        onClick={() => onOpen(item.id)}
                                    >
                                        {status === "DRAFT" ? "Continuar" : "Ver"}
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {pager}
        </div>
    );
}
