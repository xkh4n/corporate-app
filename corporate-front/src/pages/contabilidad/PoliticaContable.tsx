import { useCallback, useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, Field, Input, Select, Spinner } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { assetAccountingService } from "../../services/assetAccountingService";
import type { AccountingClass, DepreciationMethod } from "../../types/assetAccounting";
import { METHOD_LABEL, formatMoney, parseAmount } from "./accountingLabels";

// Politica contable de activos (plan 007): umbral de capitalizacion y clases
// de activo con su vida util, metodo y tasa residual por defecto. Las clases
// no se borran (activar/desactivar). Editar exige asset-accounting-policy:update.
const REQUIRED_PERMISSIONS = ["asset-accounting-policy:read"] as const;
const TH = "whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-600";
const CODE_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

interface ClassDraft {
    name: string;
    usefulLifeMonths: string;
    defaultMethod: DepreciationMethod;
    residualPercent: string;
    isActive: boolean;
}

function toDraft(accountingClass: AccountingClass): ClassDraft {
    return {
        name: accountingClass.name,
        usefulLifeMonths: String(accountingClass.usefulLifeMonths),
        defaultMethod: accountingClass.defaultMethod,
        residualPercent: String(Math.round(Number(accountingClass.residualRate) * 10000) / 100),
        isActive: accountingClass.isActive,
    };
}

// "10" (%) -> 0.1; valida vida util y porcentaje.
function parseDraft(draft: ClassDraft) {
    const usefulLifeMonths = Number(draft.usefulLifeMonths);
    const percent = parseAmount(draft.residualPercent);
    if (draft.name.trim().length < 2) throw createValidationError("El nombre de la clase es obligatorio");
    if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths < 1 || usefulLifeMonths > 1200) {
        throw createValidationError("La vida útil debe ser un entero entre 1 y 1200 meses");
    }
    if (percent === null || percent < 0 || percent >= 100) {
        throw createValidationError("El valor residual debe ser un porcentaje entre 0 y menos de 100");
    }
    return {
        name: draft.name.trim(),
        usefulLifeMonths,
        defaultMethod: draft.defaultMethod,
        residualRate: Math.round(percent * 100) / 10000,
        isActive: draft.isActive,
    };
}

export default function PoliticaContable() {
    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <PolicyContent />
        </RequirePermissions>
    );
}

function PolicyContent() {
    const navigate = useNavigate();
    const { can } = useAuth();
    const canUpdate = can("asset-accounting-policy:update");

    const [loading, setLoading] = useState(true);
    const [threshold, setThreshold] = useState("");
    const [classes, setClasses] = useState<AccountingClass[]>([]);
    const [drafts, setDrafts] = useState<Record<number, ClassDraft>>({});
    const [savingId, setSavingId] = useState<number | "policy" | "new" | null>(null);
    const [newCode, setNewCode] = useState("");
    const [newDraft, setNewDraft] = useState<ClassDraft>({
        name: "",
        usefulLifeMonths: "",
        defaultMethod: "LINEAR",
        residualPercent: "0",
        isActive: true,
    });

    const load = useCallback(async () => {
        try {
            const [policy, list] = await Promise.all([
                assetAccountingService.getPolicy(),
                assetAccountingService.listClasses(true),
            ]);
            setThreshold(policy.capitalizationThreshold);
            setClasses(list);
            setDrafts(Object.fromEntries(list.map((item) => [item.id, toDraft(item)])));
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setLoading(false);
        }
    }, [navigate]);

    useEffect(() => {
        void load();
    }, [load]);

    function updateDraft(id: number, patch: Partial<ClassDraft>) {
        setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));
    }

    async function handleSaveThreshold(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        try {
            const value = parseAmount(threshold);
            if (value === null || value < 0) throw createValidationError("El umbral debe ser un monto mayor o igual a 0");
            setSavingId("policy");
            const policy = await assetAccountingService.updatePolicy(value);
            setThreshold(policy.capitalizationThreshold);
            showSuccessToast(`Umbral de capitalización: ${formatMoney(policy.capitalizationThreshold)}`);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setSavingId(null);
        }
    }

    async function handleSaveClass(accountingClass: AccountingClass) {
        const draft = drafts[accountingClass.id];
        if (!draft) return;
        try {
            const input = parseDraft(draft);
            setSavingId(accountingClass.id);
            await assetAccountingService.updateClass(accountingClass.id, input);
            showSuccessToast(`Clase «${input.name}» actualizada`);
            await load();
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setSavingId(null);
        }
    }

    async function handleCreateClass(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        try {
            const code = newCode.trim().toUpperCase();
            if (!CODE_PATTERN.test(code)) {
                throw createValidationError("El código va en mayúsculas, números y guiones (ej. COMPUTER-EQUIPMENT)");
            }
            const input = parseDraft(newDraft);
            setSavingId("new");
            await assetAccountingService.createClass({ code, ...input });
            showSuccessToast(`Clase «${input.name}» creada`);
            setNewCode("");
            setNewDraft({ name: "", usefulLifeMonths: "", defaultMethod: "LINEAR", residualPercent: "0", isActive: true });
            await load();
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setSavingId(null);
        }
    }

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Spinner />
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Política Contable de Activos</h1>

            <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8 space-y-6">
                <form
                    onSubmit={(event) => void handleSaveThreshold(event)}
                    className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-end"
                >
                    <Field label="Umbral de capitalización" htmlFor="threshold">
                        <Input
                            id="threshold"
                            value={threshold}
                            inputMode="decimal"
                            disabled={!canUpdate}
                            onChange={(e) => setThreshold(e.target.value)}
                            className="bg-zinc-100 focus:bg-indigo-100"
                        />
                    </Field>
                    <p className="max-w-md text-xs text-slate-500">
                        Bajo este valor, la clasificación sugiere tratar la compra como gasto; capitalizarla igual exige confirmación.
                        0 = sin umbral.
                    </p>
                    {canUpdate && (
                        <Button type="submit" variant="success" className="w-full sm:w-auto" loading={savingId === "policy"}>
                            Guardar umbral
                        </Button>
                    )}
                </form>

                <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
                    <h2 className="text-base font-semibold text-slate-800">Clases de activo</h2>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className={TH}>Código</th>
                                    <th className={TH}>Nombre</th>
                                    <th className={TH}>Vida útil (meses)</th>
                                    <th className={TH}>Método</th>
                                    <th className={TH}>Residual %</th>
                                    <th className={TH}>Activa</th>
                                    <th className="px-3 py-2" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {classes.map((accountingClass) => {
                                    const draft = drafts[accountingClass.id];
                                    if (!draft) return null;
                                    return (
                                        <tr key={accountingClass.id}>
                                            <td className="whitespace-nowrap px-3 py-2">
                                                <code className="text-xs">{accountingClass.code}</code>
                                            </td>
                                            <td className="min-w-[12rem] px-3 py-2">
                                                <Input
                                                    aria-label="Nombre"
                                                    value={draft.name}
                                                    disabled={!canUpdate}
                                                    onChange={(e) => updateDraft(accountingClass.id, { name: e.target.value })}
                                                    className="bg-zinc-100 focus:bg-indigo-100"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <Input
                                                    aria-label="Vida útil"
                                                    type="number"
                                                    min={1}
                                                    value={draft.usefulLifeMonths}
                                                    disabled={!canUpdate}
                                                    onChange={(e) =>
                                                        updateDraft(accountingClass.id, { usefulLifeMonths: e.target.value })
                                                    }
                                                    className="w-24 bg-zinc-100 focus:bg-indigo-100"
                                                />
                                            </td>
                                            <td className="min-w-[10rem] px-3 py-2">
                                                <Select
                                                    aria-label="Método"
                                                    value={draft.defaultMethod}
                                                    disabled={!canUpdate}
                                                    onChange={(e) =>
                                                        updateDraft(accountingClass.id, {
                                                            defaultMethod: e.target.value as DepreciationMethod,
                                                        })
                                                    }
                                                    className="bg-zinc-100 focus:bg-indigo-100"
                                                >
                                                    {(Object.keys(METHOD_LABEL) as DepreciationMethod[]).map((value) => (
                                                        <option key={value} value={value}>
                                                            {METHOD_LABEL[value]}
                                                        </option>
                                                    ))}
                                                </Select>
                                            </td>
                                            <td className="px-3 py-2">
                                                <Input
                                                    aria-label="Residual %"
                                                    value={draft.residualPercent}
                                                    inputMode="decimal"
                                                    disabled={!canUpdate}
                                                    onChange={(e) =>
                                                        updateDraft(accountingClass.id, { residualPercent: e.target.value })
                                                    }
                                                    className="w-20 bg-zinc-100 focus:bg-indigo-100"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <input
                                                    type="checkbox"
                                                    className="h-5 w-5"
                                                    aria-label="Activa"
                                                    checked={draft.isActive}
                                                    disabled={!canUpdate}
                                                    onChange={(e) => updateDraft(accountingClass.id, { isActive: e.target.checked })}
                                                />
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                {canUpdate && (
                                                    <Button
                                                        type="button"
                                                        variant="secondary"
                                                        className="whitespace-nowrap px-3! py-2! text-xs sm:py-1!"
                                                        loading={savingId === accountingClass.id}
                                                        onClick={() => void handleSaveClass(accountingClass)}
                                                    >
                                                        Guardar
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {canUpdate && (
                        <form
                            onSubmit={(event) => void handleCreateClass(event)}
                            className="grid grid-cols-1 items-end gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 min-[1000px]:grid-cols-6"
                        >
                            <Field label="Código" htmlFor="newCode">
                                <Input
                                    id="newCode"
                                    value={newCode}
                                    maxLength={30}
                                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                                    placeholder="ej. SOFTWARE"
                                    className="bg-zinc-100 focus:bg-indigo-100"
                                />
                            </Field>
                            <Field label="Nombre" htmlFor="newName">
                                <Input
                                    id="newName"
                                    value={newDraft.name}
                                    maxLength={100}
                                    onChange={(e) => setNewDraft({ ...newDraft, name: e.target.value })}
                                    className="bg-zinc-100 focus:bg-indigo-100"
                                />
                            </Field>
                            <Field label="Vida útil (meses)" htmlFor="newLife">
                                <Input
                                    id="newLife"
                                    type="number"
                                    min={1}
                                    value={newDraft.usefulLifeMonths}
                                    onChange={(e) => setNewDraft({ ...newDraft, usefulLifeMonths: e.target.value })}
                                    className="bg-zinc-100 focus:bg-indigo-100"
                                />
                            </Field>
                            <Field label="Método" htmlFor="newMethod">
                                <Select
                                    id="newMethod"
                                    value={newDraft.defaultMethod}
                                    onChange={(e) => setNewDraft({ ...newDraft, defaultMethod: e.target.value as DepreciationMethod })}
                                    className="bg-zinc-100 focus:bg-indigo-100"
                                >
                                    {(Object.keys(METHOD_LABEL) as DepreciationMethod[]).map((value) => (
                                        <option key={value} value={value}>
                                            {METHOD_LABEL[value]}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label="Residual %" htmlFor="newResidual">
                                <Input
                                    id="newResidual"
                                    value={newDraft.residualPercent}
                                    inputMode="decimal"
                                    onChange={(e) => setNewDraft({ ...newDraft, residualPercent: e.target.value })}
                                    className="bg-zinc-100 focus:bg-indigo-100"
                                />
                            </Field>
                            <Button type="submit" variant="success" loading={savingId === "new"}>
                                Crear clase
                            </Button>
                        </form>
                    )}
                </section>
            </div>
        </div>
    );
}
