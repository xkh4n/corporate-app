import { useMemo, useState } from "react";
import { Input, Spinner } from "./ui";
import type { Permission } from "../types";

function permissionLabel(permission: Permission): string {
    return permission.description ?? `${permission.resource}:${permission.action}`;
}

// Seleccion de los permisos base que incluye un permiso de pantalla
// ("access", plan 006), con busqueda. Lo usan "Nuevo Permiso" y "Nueva
// Pantalla". El llamador filtra los "access" de la lista: un agrupador no
// puede incluir a otro (lo rechaza el backend).
export function PermissionChecklist({
    permissions,
    selected,
    onToggle,
    loading = false,
}: {
    permissions: Permission[];
    selected: Set<number>;
    onToggle: (id: number) => void;
    loading?: boolean;
}) {
    const [search, setSearch] = useState("");

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return permissions;
        return permissions.filter((permission) =>
            `${permissionLabel(permission)} ${permission.resource}:${permission.action}`.toLowerCase().includes(term),
        );
    }, [permissions, search]);

    return (
        <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
            <h2 className="text-sm font-semibold text-slate-700">Permisos que incluye ({selected.size} seleccionados)</h2>
            <p className="mt-1 text-xs text-slate-500">
                Al asignar este permiso de pantalla a un rol, el rol obtiene todos los permisos marcados.
            </p>
            <div className="mt-3 max-w-sm">
                <Input
                    placeholder="Buscar permiso..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="bg-zinc-100 focus:bg-indigo-100"
                />
            </div>
            {loading ? (
                <div className="flex justify-center py-6">
                    <Spinner />
                </div>
            ) : (
                <ul className="mt-3 grid max-h-80 grid-cols-1 gap-1 overflow-y-auto min-[800px]:grid-cols-2">
                    {filtered.map((permission) => (
                        <li key={permission.id}>
                            <label className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-sm hover:bg-slate-50">
                                <input
                                    type="checkbox"
                                    className="mt-0.5"
                                    checked={selected.has(permission.id)}
                                    onChange={() => onToggle(permission.id)}
                                />
                                <span>
                                    <span className="text-slate-800">{permissionLabel(permission)}</span>
                                    <code className="ml-1 break-all text-xs text-slate-500">
                                        {permission.resource}:{permission.action}
                                    </code>
                                </span>
                            </label>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
