import { useState, useEffect } from "react";
import { RequirePermissions } from "../../components/RequirePermissions";
import { useNavigate } from "react-router-dom";
import { handleError } from "../../lib/Errors";
import { Field, Button, Select, Spinner } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import type { Role, Permission } from "../../types";
import { roleService, permissionService } from "../../services";

// "permissions:update" gatea GET/POST/DELETE /roles/:id/permissions (ver
// role.routes.ts en corporate-api); "roles:read" hace falta para el combo de
// roles (GET /roles). GET /permissions esta abierto a cualquier autenticado.
const REQUIRED_PERMISSIONS = ["permissions:update", "roles:read"] as const;

function permissionKey(permission: Pick<Permission, "resource" | "action">): string {
    return `${permission.resource}:${permission.action}`;
}

export default function AsignarPermissionToRole() {
    const [catalogsLoading, setCatalogsLoading] = useState(true);
    const navigate = useNavigate();

    const [roles, setRoles] = useState<Role[]>([]);
    const [roleSelected, setRoleSelected] = useState("");

    const [permisos, setPermisos] = useState<Permission[]>([]);
    const [permisoSelected, setPermisoSelected] = useState("");

    // Permisos que el rol seleccionado YA tiene (se recargan desde el
    // backend cada vez que cambia el rol, ver GET /roles/:id/permissions) -no
    // se acumulan a mano en el front para no perder de vista permisos que el
    // rol ya traia de antes.
    const [assignedPermissions, setAssignedPermissions] = useState<Permission[]>([]);
    const [loadingAssigned, setLoadingAssigned] = useState(false);

    // Permiso elegido en el select, pendiente de confirmar -todavia no se
    // mando nada al backend (ver handleConfirm).
    const [pendingPermission, setPendingPermission] = useState<Permission | null>(null);
    const [confirming, setConfirming] = useState(false);

    // Permiso ya asignado que se pidio quitar, pendiente de confirmar -mismo
    // patron de "elegir primero, confirmar despues" que pendingPermission.
    const [pendingRemoval, setPendingRemoval] = useState<Permission | null>(null);
    const [removing, setRemoving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [roleRes, permRes] = await Promise.all([
                    roleService.list({ limit: 1000 }),
                    permissionService.list({ limit: 1000 }),
                ]);
                if (cancelled) return;
                setRoles(roleRes.items);
                setPermisos(permRes.items);
            } catch (error) {
                handleError(error, navigate);
            } finally {
                if (!cancelled) setCatalogsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [navigate]);

    useEffect(() => {
        if (!roleSelected) {
            setAssignedPermissions([]);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                setLoadingAssigned(true);
                const current = await roleService.getPermissions(Number(roleSelected));
                if (cancelled) return;
                setAssignedPermissions(current);
            } catch (error) {
                handleError(error, navigate);
            } finally {
                if (!cancelled) setLoadingAssigned(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [roleSelected, navigate]);

    const selectedRole = roles.find((role) => String(role.id) === roleSelected);
    const assignedIds = new Set(assignedPermissions.map((permission) => permission.id));
    // No se ofrecen en el combo permisos que el rol ya tiene -evita mandar un
    // duplicado que el backend igual ignoraria (addRolePermission es
    // idempotente), pero asi queda claro en la UI que ya esta asignado.
    const availablePermisos = permisos.filter((permission) => !assignedIds.has(permission.id));

    // Permisos de pantalla ("access", plan 006) asignados al rol y lo que
    // incluye cada uno (GET /permissions ya trae includedPermissions). Un
    // permiso base cubierto por una pantalla asignada no se puede quitar
    // directo: el backend responde 409 porque el rol lo seguiria teniendo.
    const includesById = new Map(permisos.map((permission) => [permission.id, permission.includedPermissions ?? []]));
    const coveredBy = new Map<number, Permission[]>();
    for (const assigned of assignedPermissions) {
        for (const included of includesById.get(assigned.id) ?? []) {
            coveredBy.set(included.id, [...(coveredBy.get(included.id) ?? []), assigned]);
        }
    }
    const pendingRemovalCoveredBy = pendingRemoval ? (coveredBy.get(pendingRemoval.id) ?? []) : [];

    function handleRoleChange(value: string) {
        setRoleSelected(value);
        setPermisoSelected("");
        setPendingPermission(null);
        setPendingRemoval(null);
    }

    function handlePermisoChange(value: string) {
        setPermisoSelected(value);
        const permission = permisos.find((item) => String(item.id) === value) ?? null;
        setPendingPermission(permission);
        // Solo una confirmacion a la vez -elegir uno para agregar cancela
        // cualquier "quitar" que hubiera quedado pendiente.
        setPendingRemoval(null);
    }

    function handleCancelPending() {
        setPendingPermission(null);
        setPermisoSelected("");
    }

    async function handleConfirmPending() {
        if (!pendingPermission || !roleSelected) return;
        try {
            setConfirming(true);
            const updated = await roleService.addPermission(Number(roleSelected), pendingPermission.id);
            setAssignedPermissions(updated);
            showSuccessToast(`Permiso "${permissionKey(pendingPermission)}" asignado al rol exitosamente`);
            setPendingPermission(null);
            setPermisoSelected("");
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setConfirming(false);
        }
    }

    function handleRequestRemoval(permission: Permission) {
        setPendingRemoval(permission);
        // Mismo criterio que arriba: pedir quitar un permiso cancela
        // cualquier "agregar" que hubiera quedado pendiente.
        setPendingPermission(null);
        setPermisoSelected("");
    }

    function handleCancelRemoval() {
        setPendingRemoval(null);
    }

    async function handleConfirmRemoval() {
        if (!pendingRemoval || !roleSelected) return;
        try {
            setRemoving(true);
            await roleService.removePermission(Number(roleSelected), pendingRemoval.id);
            setAssignedPermissions((current) => current.filter((permission) => permission.id !== pendingRemoval.id));
            showSuccessToast(`Permiso "${permissionKey(pendingRemoval)}" quitado del rol exitosamente`);
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
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Modificar Permisos</h1>
                {catalogsLoading ? (
                    <div className="flex justify-center py-12">
                        <Spinner />
                    </div>
                ) : (
                    <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="grid grid-cols-1 max-[799px]:grid-cols-1 min-[800px]:grid-cols-6 min-[1000px]:grid-cols-8 min-[1200px]:grid-cols-10 min-[1400px]:grid-cols-12 gap-4">
                            {/* ROL ASOCIADO */}
                            <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-6">
                                <Field label="Rol Asociado" htmlFor="rolePosition">
                                    <Select
                                        id="rolePosition"
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                        value={roleSelected}
                                        onChange={(e) => handleRoleChange(e.target.value)}
                                        required
                                    >
                                        <option value="">
                                            Seleccione un Rol
                                        </option>
                                        {roles.map((role) => (
                                            <option key={role.id} value={role.id}>
                                                {role.name}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                            </div>
                            {/* PERMISOS */}
                            <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-6">
                                <Field label="Permisos" htmlFor="permissionsToRole">
                                    <Select
                                        id="permissionsToRole"
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                        value={permisoSelected}
                                        onChange={(e) => handlePermisoChange(e.target.value)}
                                        disabled={!roleSelected || loadingAssigned}
                                        required
                                    >
                                        <option value="">
                                            {roleSelected ? "Seleccione un Permiso" : "Primero seleccione el Rol"}
                                        </option>
                                        {availablePermisos.map((permission) => (
                                            <option key={permission.id} value={permission.id}>
                                                {permission.description ?? permissionKey(permission)}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                            </div>
                        </div>

                        {/* CONFIRMACION DEL PERMISO RECIEN SELECCIONADO */}
                        {pendingPermission && selectedRole && (
                            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                                <p className="text-sm text-amber-900">
                                    ¿Desea asignar el permiso{" "}
                                    <span className="font-semibold">
                                        {pendingPermission.description ?? permissionKey(pendingPermission)}
                                    </span>{" "}
                                    (<code>{permissionKey(pendingPermission)}</code>) al rol{" "}
                                    <span className="font-semibold">{selectedRole.name}</span>?
                                </p>
                                <div className="mt-3 flex justify-end gap-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={handleCancelPending}
                                        disabled={confirming}
                                    >
                                        Cancelar
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="success"
                                        loading={confirming}
                                        onClick={() => void handleConfirmPending()}
                                    >
                                        Sí, asignar
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* QUITAR UN PERMISO QUE UNA PANTALLA ASIGNADA SIGUE OTORGANDO: no se ofrece */}
                        {pendingRemoval && selectedRole && pendingRemovalCoveredBy.length > 0 && (
                            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                                <p className="text-sm text-amber-900">
                                    El rol <span className="font-semibold">{selectedRole.name}</span> seguiría teniendo{" "}
                                    <span className="font-semibold">
                                        {pendingRemoval.description ?? permissionKey(pendingRemoval)}
                                    </span>{" "}
                                    por{" "}
                                    {pendingRemovalCoveredBy
                                        .map((bundle) => `«${bundle.description ?? permissionKey(bundle)}»`)
                                        .join(", ")}
                                    . Quite primero esa pantalla del rol o edítela en «Permisos de Pantalla».
                                </p>
                                <div className="mt-3 flex justify-end">
                                    <Button type="button" variant="secondary" onClick={handleCancelRemoval}>
                                        Entendido
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* CONFIRMACION PARA QUITAR UN PERMISO YA ASIGNADO */}
                        {pendingRemoval && selectedRole && pendingRemovalCoveredBy.length === 0 && (
                            <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 p-4">
                                <p className="text-sm text-rose-900">
                                    ¿Desea quitar el permiso{" "}
                                    <span className="font-semibold">
                                        {pendingRemoval.description ?? permissionKey(pendingRemoval)}
                                    </span>{" "}
                                    (<code>{permissionKey(pendingRemoval)}</code>) del rol{" "}
                                    <span className="font-semibold">{selectedRole.name}</span>?
                                </p>
                                <div className="mt-3 flex justify-end gap-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={handleCancelRemoval}
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

                        {/* PERMISOS YA ASIGNADOS AL ROL */}
                        {roleSelected && (
                            <div className="mt-6">
                                <h2 className="mb-3 text-sm font-semibold text-slate-700">
                                    Permisos asignados a {selectedRole?.name}
                                </h2>
                                {loadingAssigned ? (
                                    <div className="flex justify-center py-6">
                                        <Spinner />
                                    </div>
                                ) : assignedPermissions.length === 0 ? (
                                    <p className="text-sm text-slate-500">Este rol todavía no tiene permisos asignados.</p>
                                ) : (
                                    <div className="grid grid-cols-1 min-[800px]:grid-cols-2 min-[1200px]:grid-cols-3 gap-3">
                                        {assignedPermissions.map((permission) => (
                                            <div
                                                key={permission.id}
                                                className="flex items-start justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
                                            >
                                                <div>
                                                    <p className="text-sm font-medium text-emerald-900">
                                                        {permission.description ?? permissionKey(permission)}
                                                    </p>
                                                    <p className="mt-1 text-xs text-emerald-700">
                                                        <code>{permissionKey(permission)}</code>
                                                    </p>
                                                    {(includesById.get(permission.id) ?? []).length > 0 && (
                                                        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-emerald-800">
                                                            {includesById.get(permission.id)!.map((included) => (
                                                                <li key={included.id}>
                                                                    {included.description ?? permissionKey(included)}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                    {coveredBy.has(permission.id) && (
                                                        <p className="mt-2 text-xs text-amber-700">
                                                            También lo otorga{" "}
                                                            {coveredBy
                                                                .get(permission.id)!
                                                                .map((bundle) => `«${bundle.description ?? permissionKey(bundle)}»`)
                                                                .join(", ")}
                                                            .
                                                        </p>
                                                    )}
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className="shrink-0 px-2! py-1! text-xs text-rose-600 hover:bg-rose-100"
                                                    onClick={() => handleRequestRemoval(permission)}
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
