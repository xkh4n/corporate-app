import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState, Input, Spinner } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { permissionService, roleService } from "../../services";
import type { IncludedPermission, PaginationMeta, Permission, Role } from "../../types";

const PAGE_SIZE = 20;

// Mismo criterio que PROTECTED_ROLE_NAME en role.service.ts (corporate-api):
// el backend rechaza habilitar/deshabilitar "admin" con 409, aca solo se
// esconde el boton para no ofrecer algo que siempre va a fallar.
const PROTECTED_ROLE_NAME = "admin";

// "read": solo lectura (Ver Rol). "deactivate": boton Deshabilitar en roles
// activos. "activate": boton Habilitar en roles inactivos.
export type RoleBrowserMode = "read" | "deactivate" | "activate";

// Textos por modo para el boton de fila y la confirmacion.
const STATUS_ACTION = {
    deactivate: {
        button: "Deshabilitar",
        confirm: "Sí, deshabilitar",
        question: "¿Desea deshabilitar el rol",
        warning: "Todos los usuarios con este rol perderán sus accesos y se cerrará su sesión de inmediato.",
        success: "deshabilitado",
        tone: "rose",
    },
    activate: {
        button: "Habilitar",
        confirm: "Sí, habilitar",
        question: "¿Desea habilitar el rol",
        warning: "Los usuarios con este rol recuperarán los permisos que el rol tenga asignados.",
        success: "habilitado",
        tone: "emerald",
    },
} as const;

// Listado de roles + permisos asignados (por descripcion, sin la clave
// recurso:accion), compartido por "Ver Rol", "Deshabilitar Roles" y
// "Habilitar Roles". El gate de permisos lo pone cada pantalla con
// RequirePermissions -este componente no asume ninguno.
export function RoleBrowser({ title, mode = "read" }: { title: string; mode?: RoleBrowserMode }) {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [roles, setRoles] = useState<Role[]>([]);
    const [pagination, setPagination] = useState<PaginationMeta | null>(null);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);

    const [selectedRole, setSelectedRole] = useState<Role | null>(null);
    const [rolePermissions, setRolePermissions] = useState<Permission[]>([]);
    const [loadingPermissions, setLoadingPermissions] = useState(false);

    // Lo que incluye cada permiso de pantalla ("access", plan 006), por id:
    // GET /roles/:id/permissions devuelve solo lo asignado directamente, sin
    // los includes. GET /permissions esta abierto, se carga una vez.
    const [includesById, setIncludesById] = useState<Map<number, IncludedPermission[]>>(new Map());

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await permissionService.list({ limit: 1000 });
                if (cancelled) return;
                setIncludesById(
                    new Map(
                        res.items
                            .filter((permission) => permission.includedPermissions?.length)
                            .map((permission) => [permission.id, permission.includedPermissions ?? []]),
                    ),
                );
            } catch (error) {
                handleError(error, navigate);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [navigate]);

    // Rol cuyo cambio de estado se pidio, pendiente de confirmar -mismo patron
    // de "elegir primero, confirmar despues" que Modificar Permisos.
    const [pendingStatusChange, setPendingStatusChange] = useState<Role | null>(null);
    const [changingStatus, setChangingStatus] = useState(false);
    const statusAction = mode === "read" ? null : STATUS_ACTION[mode];

    useEffect(() => {
        let cancelled = false;

        (async () => {
            setLoading(true);
            try {
                const res = await roleService.list({
                    page,
                    limit: PAGE_SIZE,
                    search: search.trim() || undefined,
                    sortBy: "name",
                    sortOrder: "asc",
                });
                if (cancelled) return;
                setRoles(res.items);
                setPagination(res.pagination);
            } catch (error) {
                handleError(error, navigate);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [navigate, search, page]);

    // Depende solo del id: deshabilitar el rol seleccionado cambia el objeto
    // (isActive) pero no sus permisos, no hace falta volver a pedirlos.
    const selectedRoleId = selectedRole?.id ?? null;
    useEffect(() => {
        if (selectedRoleId === null) {
            setRolePermissions([]);
            return;
        }
        let cancelled = false;

        (async () => {
            setLoadingPermissions(true);
            try {
                const permissions = await roleService.getPermissions(selectedRoleId);
                if (cancelled) return;
                setRolePermissions(permissions);
            } catch (error) {
                handleError(error, navigate);
            } finally {
                if (!cancelled) setLoadingPermissions(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [navigate, selectedRoleId]);

    function handleSearchChange(value: string) {
        setSearch(value);
        setPage(1);
    }

    function handleToggleRole(role: Role) {
        setSelectedRole((current) => (current?.id === role.id ? null : role));
    }

    async function handleConfirmStatusChange() {
        if (!pendingStatusChange || !statusAction) return;
        const target = pendingStatusChange;
        const isActive = mode === "activate";
        try {
            setChangingStatus(true);
            if (isActive) {
                await roleService.activate(target.id);
            } else {
                await roleService.deactivate(target.id);
            }
            // DELETE /roles/:id responde 204 sin cuerpo: se refleja el cambio
            // en la fila local en vez de recargar todo el listado (mismo
            // criterio para activate, aunque devuelva el rol).
            setRoles((current) => current.map((role) => (role.id === target.id ? { ...role, isActive } : role)));
            setSelectedRole((current) => (current?.id === target.id ? { ...current, isActive } : current));
            showSuccessToast(`Rol "${target.name}" ${statusAction.success} exitosamente`);
            setPendingStatusChange(null);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setChangingStatus(false);
        }
    }

    return (
        <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">{title}</h1>

            <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
                <div className="mb-4 max-w-sm">
                    <Input
                        placeholder="Buscar por nombre o descripción..."
                        value={search}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="bg-white"
                    />
                </div>

                {/* CONFIRMACION PARA HABILITAR / DESHABILITAR UN ROL */}
                {pendingStatusChange && statusAction && (
                    <div
                        className={`mb-4 rounded-lg border p-4 ${
                            statusAction.tone === "rose"
                                ? "border-rose-300 bg-rose-50 text-rose-900"
                                : "border-emerald-300 bg-emerald-50 text-emerald-900"
                        }`}
                    >
                        <p className="text-sm">
                            {statusAction.question} <span className="font-semibold">{pendingStatusChange.name}</span>?{" "}
                            {statusAction.warning}
                        </p>
                        <div className="mt-3 flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setPendingStatusChange(null)}
                                disabled={changingStatus}
                            >
                                Cancelar
                            </Button>
                            {statusAction.tone === "rose" ? (
                                <Button
                                    type="button"
                                    variant="primary"
                                    className="bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600"
                                    loading={changingStatus}
                                    onClick={() => void handleConfirmStatusChange()}
                                >
                                    {statusAction.confirm}
                                </Button>
                            ) : (
                                <Button
                                    type="button"
                                    variant="success"
                                    loading={changingStatus}
                                    onClick={() => void handleConfirmStatusChange()}
                                >
                                    {statusAction.confirm}
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="flex justify-center py-12">
                        <Spinner />
                    </div>
                ) : roles.length === 0 ? (
                    <EmptyState title="Sin roles" description="No se encontraron roles con ese criterio." />
                ) : (
                    <>
                        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Rol</th>
                                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Descripción</th>
                                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Estado</th>
                                        <th className="px-4 py-2" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {roles.map((role) => {
                                        const isSelected = selectedRole?.id === role.id;
                                        // Deshabilitar solo aplica a activos, habilitar solo a
                                        // inactivos; "admin" nunca (solo por query en el motor).
                                        const showStatusButton =
                                            statusAction !== null &&
                                            role.name !== PROTECTED_ROLE_NAME &&
                                            role.isActive === (mode === "deactivate");
                                        return (
                                            <tr key={role.id} className={isSelected ? "bg-indigo-50" : undefined}>
                                                <td className="px-4 py-2 font-medium text-slate-900">{role.name}</td>
                                                <td className="px-4 py-2 text-slate-600">{role.description ?? "-"}</td>
                                                <td className="px-4 py-2">
                                                    <span
                                                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                                            role.isActive
                                                                ? "bg-emerald-100 text-emerald-700"
                                                                : "bg-slate-200 text-slate-500"
                                                        }`}
                                                    >
                                                        {role.isActive ? "Activo" : "Inactivo"}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2 text-right whitespace-nowrap">
                                                    {showStatusButton && statusAction && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            className={`mr-2 px-2! py-1! text-xs ${
                                                                statusAction.tone === "rose"
                                                                    ? "text-rose-600 hover:bg-rose-100"
                                                                    : "text-emerald-700 hover:bg-emerald-100"
                                                            }`}
                                                            onClick={() => setPendingStatusChange(role)}
                                                        >
                                                            {statusAction.button}
                                                        </Button>
                                                    )}
                                                    <Button
                                                        type="button"
                                                        variant={isSelected ? "secondary" : "ghost"}
                                                        className="px-2! py-1! text-xs"
                                                        onClick={() => handleToggleRole(role)}
                                                    >
                                                        {isSelected ? "Ocultar permisos" : "Ver permisos"}
                                                    </Button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {pagination && pagination.totalPages > 1 && (
                            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                                <span>
                                    Página {pagination.currentPage} de {pagination.totalPages} ({pagination.totalItems} roles)
                                </span>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        disabled={!pagination.hasPrevPage}
                                        onClick={() => setPage((current) => current - 1)}
                                    >
                                        Anterior
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        disabled={!pagination.hasNextPage}
                                        onClick={() => setPage((current) => current + 1)}
                                    >
                                        Siguiente
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* PERMISOS DEL ROL SELECCIONADO: por descripcion, sin la clave recurso:accion */}
                {selectedRole && (
                    <div className="mt-6">
                        <h2 className="mb-3 text-sm font-semibold text-slate-700">Permisos asignados a {selectedRole.name}</h2>
                        {loadingPermissions ? (
                            <div className="flex justify-center py-6">
                                <Spinner />
                            </div>
                        ) : rolePermissions.length === 0 ? (
                            <p className="text-sm text-slate-500">Este rol todavía no tiene permisos asignados.</p>
                        ) : (
                            <ul className="grid grid-cols-1 min-[800px]:grid-cols-2 min-[1200px]:grid-cols-3 gap-3">
                                {rolePermissions.map((permission) => (
                                    <li
                                        key={permission.id}
                                        className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-900"
                                    >
                                        {/* description es opcional en la tabla: sin ella, recurso y accion
                                            por separado como ultimo recurso para no dejar la tarjeta vacia. */}
                                        {permission.description ?? `${permission.resource} (${permission.action})`}
                                        {includesById.get(permission.id)?.length ? (
                                            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs font-normal text-emerald-800">
                                                {includesById.get(permission.id)!.map((included) => (
                                                    <li key={included.id}>
                                                        {included.description ?? `${included.resource} (${included.action})`}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
