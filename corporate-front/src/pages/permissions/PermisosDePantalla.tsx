import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, Field, Select, Spinner } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { permissionService } from "../../services";
import type { IncludedPermission, Permission } from "../../types";
import { ACCESS_ACTION } from "../../types/permission";

// POST/DELETE /permissions/:id/includes exigen "permissions:update" (ver
// permission.routes.ts en corporate-api): cambiar lo que incluye un permiso
// de pantalla cambia al instante el acceso de TODOS los roles que lo tienen.
// GET /permissions esta abierto a cualquier autenticado.
const REQUIRED_PERMISSIONS = ["permissions:update"] as const;

function label(permission: IncludedPermission): string {
    return permission.description ?? `${permission.resource}:${permission.action}`;
}

function key(permission: IncludedPermission): string {
    return `${permission.resource}:${permission.action}`;
}

export default function PermisosDePantalla() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);

    const [screens, setScreens] = useState<Permission[]>([]);
    const [basePermissions, setBasePermissions] = useState<Permission[]>([]);
    const [screenSelected, setScreenSelected] = useState("");
    const [included, setIncluded] = useState<IncludedPermission[]>([]);

    const [permissionSelected, setPermissionSelected] = useState("");
    const [pendingAdd, setPendingAdd] = useState<Permission | null>(null);
    const [adding, setAdding] = useState(false);
    const [pendingRemoval, setPendingRemoval] = useState<IncludedPermission | null>(null);
    const [removing, setRemoving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await permissionService.list({ limit: 1000, sortBy: "resource", sortOrder: "asc" });
                if (cancelled) return;
                setScreens(res.items.filter((permission) => permission.action === ACCESS_ACTION));
                setBasePermissions(res.items.filter((permission) => permission.action !== ACCESS_ACTION));
            } catch (error) {
                handleError(error, navigate);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [navigate]);

    const selectedScreen = screens.find((screen) => String(screen.id) === screenSelected) ?? null;
    const includedIds = new Set(included.map((permission) => permission.id));
    const available = basePermissions.filter((permission) => !includedIds.has(permission.id));

    function handleScreenChange(value: string) {
        setScreenSelected(value);
        const screen = screens.find((item) => String(item.id) === value);
        setIncluded(screen?.includedPermissions ?? []);
        setPermissionSelected("");
        setPendingAdd(null);
        setPendingRemoval(null);
    }

    // Mantiene sincronizada la lista cargada al inicio, para que volver a
    // elegir esta pantalla en el combo muestre lo ultimo guardado.
    function syncScreenIncludes(screenId: number, next: IncludedPermission[]) {
        setIncluded(next);
        setScreens((current) =>
            current.map((screen) => (screen.id === screenId ? { ...screen, includedPermissions: next } : screen)),
        );
    }

    function handlePermissionChange(value: string) {
        setPermissionSelected(value);
        setPendingAdd(basePermissions.find((permission) => String(permission.id) === value) ?? null);
        setPendingRemoval(null);
    }

    async function handleConfirmAdd() {
        if (!pendingAdd || !selectedScreen) return;
        try {
            setAdding(true);
            const next = await permissionService.addInclude(selectedScreen.id, pendingAdd.id);
            syncScreenIncludes(selectedScreen.id, next);
            showSuccessToast(`"${label(pendingAdd)}" agregado a la pantalla`);
            setPendingAdd(null);
            setPermissionSelected("");
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setAdding(false);
        }
    }

    async function handleConfirmRemoval() {
        if (!pendingRemoval || !selectedScreen) return;
        try {
            setRemoving(true);
            await permissionService.removeInclude(selectedScreen.id, pendingRemoval.id);
            syncScreenIncludes(
                selectedScreen.id,
                included.filter((permission) => permission.id !== pendingRemoval.id),
            );
            showSuccessToast(`"${label(pendingRemoval)}" quitado de la pantalla`);
            setPendingRemoval(null);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setRemoving(false);
        }
    }

    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <div className="flex flex-col items-center justify-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Permisos de Pantalla</h1>
                {loading ? (
                    <div className="flex justify-center py-12">
                        <Spinner />
                    </div>
                ) : (
                    <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="grid grid-cols-1 min-[1000px]:grid-cols-2 gap-4">
                            <Field label="Pantalla" htmlFor="screenPermission">
                                <Select
                                    id="screenPermission"
                                    className="bg-zinc-100 focus:bg-indigo-100"
                                    value={screenSelected}
                                    onChange={(e) => handleScreenChange(e.target.value)}
                                >
                                    <option value="">Seleccione una pantalla</option>
                                    {screens.map((screen) => (
                                        <option key={screen.id} value={screen.id}>
                                            {label(screen)}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label="Agregar permiso" htmlFor="includePermission">
                                <Select
                                    id="includePermission"
                                    className="bg-zinc-100 focus:bg-indigo-100"
                                    value={permissionSelected}
                                    onChange={(e) => handlePermissionChange(e.target.value)}
                                    disabled={!selectedScreen}
                                >
                                    <option value="">
                                        {selectedScreen ? "Seleccione un permiso" : "Primero seleccione la pantalla"}
                                    </option>
                                    {available.map((permission) => (
                                        <option key={permission.id} value={permission.id}>
                                            {label(permission)} ({key(permission)})
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        </div>

                        <p className="mt-3 text-xs text-slate-500">
                            Los cambios aplican de inmediato a todos los roles que tienen esta pantalla; los usuarios
                            los ven al recargar la aplicación.
                        </p>

                        {pendingAdd && selectedScreen && (
                            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                                <p className="text-sm text-amber-900">
                                    ¿Desea que la pantalla <span className="font-semibold">{label(selectedScreen)}</span>{" "}
                                    incluya <span className="font-semibold">{label(pendingAdd)}</span> (
                                    <code>{key(pendingAdd)}</code>)?
                                </p>
                                <div className="mt-3 flex justify-end gap-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={() => {
                                            setPendingAdd(null);
                                            setPermissionSelected("");
                                        }}
                                        disabled={adding}
                                    >
                                        Cancelar
                                    </Button>
                                    <Button type="button" variant="success" loading={adding} onClick={() => void handleConfirmAdd()}>
                                        Sí, agregar
                                    </Button>
                                </div>
                            </div>
                        )}

                        {pendingRemoval && selectedScreen && (
                            <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 p-4">
                                <p className="text-sm text-rose-900">
                                    ¿Desea quitar <span className="font-semibold">{label(pendingRemoval)}</span> (
                                    <code>{key(pendingRemoval)}</code>) de la pantalla{" "}
                                    <span className="font-semibold">{label(selectedScreen)}</span>? Los roles que solo lo
                                    tenían por esta pantalla lo perderán.
                                </p>
                                <div className="mt-3 flex justify-end gap-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={() => setPendingRemoval(null)}
                                        disabled={removing}
                                    >
                                        Cancelar
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="primary"
                                        className="bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600"
                                        loading={removing}
                                        onClick={() => void handleConfirmRemoval()}
                                    >
                                        Sí, quitar
                                    </Button>
                                </div>
                            </div>
                        )}

                        {selectedScreen && (
                            <div className="mt-6">
                                <h2 className="mb-3 text-sm font-semibold text-slate-700">
                                    Permisos incluidos en {label(selectedScreen)} ({key(selectedScreen)})
                                </h2>
                                {included.length === 0 ? (
                                    <p className="text-sm text-slate-500">Esta pantalla todavía no incluye permisos.</p>
                                ) : (
                                    <div className="grid grid-cols-1 min-[800px]:grid-cols-2 min-[1200px]:grid-cols-3 gap-3">
                                        {included.map((permission) => (
                                            <div
                                                key={permission.id}
                                                className="flex items-start justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
                                            >
                                                <div>
                                                    <p className="text-sm font-medium text-emerald-900">{label(permission)}</p>
                                                    <p className="mt-1 text-xs text-emerald-700">
                                                        <code>{key(permission)}</code>
                                                    </p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className="shrink-0 px-2! py-1! text-xs text-rose-600 hover:bg-rose-100"
                                                    onClick={() => {
                                                        setPendingRemoval(permission);
                                                        setPendingAdd(null);
                                                        setPermissionSelected("");
                                                    }}
                                                >
                                                    Quitar
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </RequirePermissions>
    );
}
