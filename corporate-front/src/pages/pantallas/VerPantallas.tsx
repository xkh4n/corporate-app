import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, EmptyState, Input, Spinner } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { menuItemService, permissionService } from "../../services";
import type { IncludedPermission, MenuItem, Permission } from "../../types";
import { ACCESS_ACTION } from "../../types/permission";

// GET /menu-items exige "menu-items:read"; GET /permissions esta abierto.
const REQUIRED_PERMISSIONS = ["menu-items:read"] as const;
// Paginado en el cliente: la busqueda ya filtra en memoria sobre todas las
// pantallas (pocas decenas), asi que se pagina el resultado filtrado.
const PAGE_SIZE = 10;

function label(permission: IncludedPermission): string {
    return permission.description ?? `${permission.resource}:${permission.action}`;
}

interface ScreenRow {
    item: MenuItem;
    parentLabel: string | null;
    permission: Permission | null;
}

// Pantallas del menu (items con link) y lo que exige cada una: el permiso de
// su item de menu y, si es un permiso de pantalla ("access", plan 006), los
// permisos base que incluye. Solo lectura: los includes se editan en
// Permisos > "Permisos de Pantalla".
export default function VerPantallas() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<ScreenRow[]>([]);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [itemsRes, permissionsRes] = await Promise.all([
                    menuItemService.list({ limit: 1000 }),
                    permissionService.list({ limit: 1000 }),
                ]);
                if (cancelled) return;
                const itemsById = new Map(itemsRes.items.map((item) => [item.id, item]));
                const permissionsById = new Map(permissionsRes.items.map((permission) => [permission.id, permission]));
                const screens = itemsRes.items
                    .filter((item) => item.link)
                    .map((item) => ({
                        item,
                        parentLabel: item.parentId !== null ? (itemsById.get(item.parentId)?.label ?? null) : null,
                        permission: item.permissionId !== null ? (permissionsById.get(item.permissionId) ?? null) : null,
                    }))
                    .sort(
                        (a, b) =>
                            (a.parentLabel ?? "").localeCompare(b.parentLabel ?? "") || a.item.label.localeCompare(b.item.label),
                    );
                setRows(screens);
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

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return rows;
        return rows.filter(({ item, parentLabel, permission }) => {
            const haystack = [
                item.label,
                item.link ?? "",
                parentLabel ?? "",
                permission ? `${label(permission)} ${permission.resource}:${permission.action}` : "",
                ...(permission?.includedPermissions ?? []).map((p) => `${label(p)} ${p.resource}:${p.action}`),
            ]
                .join(" ")
                .toLowerCase();
            return haystack.includes(term);
        });
    }, [rows, search]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    function handleSearchChange(value: string) {
        setSearch(value);
        setPage(1);
    }

    // Se muestra arriba y abajo de la tabla, para no tener que bajar hasta
    // el final para cambiar de pagina.
    const pagination =
        totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm text-slate-600">
                <span>
                    Página {currentPage} de {totalPages} ({filtered.length} pantallas)
                </span>
                <div className="flex gap-2">
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={currentPage <= 1}
                        onClick={() => setPage(currentPage - 1)}
                    >
                        Anterior
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={currentPage >= totalPages}
                        onClick={() => setPage(currentPage + 1)}
                    >
                        Siguiente
                    </Button>
                </div>
            </div>
        ) : null;

    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Pantallas</h1>

                <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="mb-4 max-w-sm">
                        <Input
                            placeholder="Buscar por pantalla, ruta o permiso..."
                            value={search}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            className="bg-white"
                        />
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Spinner />
                        </div>
                    ) : filtered.length === 0 ? (
                        <EmptyState title="Sin pantallas" description="No se encontraron pantallas con ese criterio." />
                    ) : (
                        <>
                        {pagination && <div className="mb-4">{pagination}</div>}
                        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Pantalla</th>
                                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Ruta</th>
                                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Estado</th>
                                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Permiso del menú</th>
                                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Permisos que incluye</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {pageRows.map(({ item, parentLabel, permission }) => {
                                        const isScreenPermission = permission?.action === ACCESS_ACTION;
                                        return (
                                            <tr key={item.id} className="align-top">
                                                <td className="px-4 py-2">
                                                    <p className="font-medium text-slate-900">{item.label}</p>
                                                    {parentLabel && <p className="text-xs text-slate-500">{parentLabel}</p>}
                                                </td>
                                                <td className="px-4 py-2 text-slate-600">
                                                    <code>{item.link}</code>
                                                </td>
                                                <td className="px-4 py-2">
                                                    <span
                                                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                                            item.isActive
                                                                ? "bg-emerald-100 text-emerald-700"
                                                                : "bg-slate-200 text-slate-500"
                                                        }`}
                                                    >
                                                        {item.isActive ? "Activa" : "Inactiva"}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2">
                                                    {permission ? (
                                                        <>
                                                            <p className="text-slate-800">{label(permission)}</p>
                                                            <code className="text-xs text-slate-500">
                                                                {permission.resource}:{permission.action}
                                                            </code>
                                                            {!isScreenPermission && (
                                                                <p className="mt-1 text-xs text-amber-700">
                                                                    No es un permiso de pantalla: el rol necesita además
                                                                    cada permiso que exige la vista.
                                                                </p>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <span className="text-xs text-amber-700">
                                                            Sin permiso: solo la ve el administrador.
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2">
                                                    {isScreenPermission && permission?.includedPermissions?.length ? (
                                                        <ul className="space-y-0.5">
                                                            {permission.includedPermissions.map((included) => (
                                                                <li key={included.id} className="text-slate-700">
                                                                    {label(included)}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    ) : isScreenPermission ? (
                                                        <span className="text-xs text-amber-700">No incluye permisos.</span>
                                                    ) : (
                                                        <span className="text-slate-400">-</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {pagination && <div className="mt-4">{pagination}</div>}
                        </>
                    )}
                </div>
            </div>
        </RequirePermissions>
    );
}
