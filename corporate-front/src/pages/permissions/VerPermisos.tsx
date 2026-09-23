import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, EmptyState, Input, Spinner } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { permissionService } from "../../services";
import type { PaginationMeta, Permission } from "../../types";

const REQUIRED_PERMISSIONS = ["permissions:read"] as const;
const PAGE_SIZE = 25;

export default function VerPermisos() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [permissions, setPermissions] = useState<Permission[]>([]);
    const [pagination, setPagination] = useState<PaginationMeta | null>(null);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            setLoading(true);
            try {
                const res = await permissionService.list({
                    page,
                    limit: PAGE_SIZE,
                    search: search.trim() || undefined,
                    sortBy: "resource",
                    sortOrder: "asc",
                });
                if (cancelled) return;
                setPermissions(res.items);
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

    function handleSearchChange(value: string) {
        setSearch(value);
        setPage(1);
    }

    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Permisos</h1>

                <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="mb-4 max-w-sm">
                        <Input
                            placeholder="Buscar por recurso, acción o descripción..."
                            value={search}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            className="bg-white"
                        />
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Spinner />
                        </div>
                    ) : permissions.length === 0 ? (
                        <EmptyState title="Sin permisos" description="No se encontraron permisos con ese criterio." />
                    ) : (
                        <>
                            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="min-w-full divide-y divide-slate-200 text-sm">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Clave</th>
                                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Recurso</th>
                                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Acción</th>
                                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Descripción</th>
                                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Incluye</th>
                                            <th className="px-4 py-2 text-left font-semibold text-slate-600">Creado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {permissions.map((permission) => (
                                            <tr key={permission.id}>
                                                <td className="px-4 py-2 font-medium text-slate-900">
                                                    <code>{`${permission.resource}:${permission.action}`}</code>
                                                </td>
                                                <td className="px-4 py-2 text-slate-600">{permission.resource}</td>
                                                <td className="px-4 py-2 text-slate-600">{permission.action}</td>
                                                <td className="px-4 py-2 text-slate-600">{permission.description ?? "-"}</td>
                                                {/* Solo los permisos de pantalla ("access", plan 006) incluyen otros */}
                                                <td className="px-4 py-2 text-slate-600">
                                                    {permission.includedPermissions?.length ? (
                                                        <ul className="space-y-0.5 text-xs">
                                                            {permission.includedPermissions.map((included) => (
                                                                <li key={included.id}>
                                                                    {included.description ?? `${included.resource}:${included.action}`}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    ) : (
                                                        "-"
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 text-slate-600">
                                                    {new Date(permission.createdAt).toLocaleDateString("es-CL")}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {pagination && pagination.totalPages > 1 && (
                                <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                                    <span>
                                        Página {pagination.currentPage} de {pagination.totalPages} ({pagination.totalItems} permisos)
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
                </div>
            </div>
        </RequirePermissions>
    );
}
