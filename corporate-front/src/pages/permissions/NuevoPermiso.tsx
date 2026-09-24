import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import { RequirePermissions } from "../../components/RequirePermissions";
import { useNavigate } from "react-router-dom";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { Field, Button, Input, Select, Textarea } from "../../components/ui";
import { PermissionChecklist } from "../../components/PermissionChecklist";
import { showSuccessToast } from "../../components/Toast";
import type { Permission, PermissionAction, PermissionCreateInput } from "../../types";
import { ACCESS_ACTION } from "../../types/permission";
import { permissionService } from "../../services";

const REQUIRED_PERMISSIONS = ["permissions:create"] as const;

const ACTION_OPTIONS: { value: PermissionAction; label: string }[] = [
    { value: "create", label: "Crear (create)" },
    { value: "read", label: "Ver (read)" },
    { value: "update", label: "Modificar (update)" },
    { value: "delete", label: "Eliminar (delete)" },
    { value: "approve", label: "Aprobar (approve)" },
    { value: "activate", label: "Habilitar (activate)" },
    { value: "access", label: "Acceso a pantalla (access)" },
    { value: "all_view", label: "Ver todo (all_view)" },
];

// Mismo formato que valida el backend (createPermissionSchema en
// permission.controller.ts): kebab-case en minusculas, es la mitad de la
// clave "recurso:accion" que usan el menu y authorize().
const RESOURCE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export default function NuevoPermiso() {
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);

    const [resource, setResource] = useState("");
    const [action, setAction] = useState<PermissionAction | "">("");
    const [description, setDescription] = useState("");

    // Permisos base que puede incluir un permiso de pantalla ("access", plan
    // 006). Se cargan solo la primera vez que se elige esa accion.
    const [basePermissions, setBasePermissions] = useState<Permission[] | null>(null);
    const [loadingBase, setLoadingBase] = useState(false);
    const [includedIds, setIncludedIds] = useState<Set<number>>(new Set());

    const isAccess = action === ACCESS_ACTION;

    useEffect(() => {
        if (!isAccess || basePermissions !== null) return;
        let cancelled = false;
        (async () => {
            setLoadingBase(true);
            try {
                const res = await permissionService.list({ limit: 1000, sortBy: "resource", sortOrder: "asc" });
                if (cancelled) return;
                // Un agrupador no puede incluir a otro (un solo nivel, ver
                // permission.service.ts en corporate-api).
                setBasePermissions(res.items.filter((permission) => permission.action !== ACCESS_ACTION));
            } catch (error) {
                handleError(error, navigate);
            } finally {
                if (!cancelled) setLoadingBase(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isAccess, basePermissions, navigate]);

    function toggleIncluded(id: number) {
        setIncludedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function resetForm() {
        setResource("");
        setAction("");
        setDescription("");
        setIncludedIds(new Set());
    }

    function validate(): PermissionCreateInput {
        const trimmedResource = resource.trim();
        if (trimmedResource.length < 2 || trimmedResource.length > 50 || !RESOURCE_PATTERN.test(trimmedResource)) {
            throw createValidationError(
                "El recurso debe ir en minúsculas, separado por guiones y sin espacios (ej. asset-returns)",
            );
        }
        if (!action) {
            throw createValidationError("Debe seleccionar la acción");
        }
        const trimmedDescription = description.trim();
        if (trimmedDescription.length < 3) {
            throw createValidationError("La descripción es obligatoria (mínimo 3 caracteres)");
        }
        if (isAccess && includedIds.size === 0) {
            throw createValidationError("Un permiso de pantalla debe incluir al menos un permiso");
        }
        return {
            resource: trimmedResource,
            action,
            description: trimmedDescription,
            ...(isAccess ? { includedPermissionIds: [...includedIds] } : {}),
        };
    }

    async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitting(true);
        try {
            const input = validate();
            const created = await permissionService.create(input);
            showSuccessToast(`Permiso "${created.resource}:${created.action}" creado exitosamente`);
            resetForm();
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setSubmitting(false);
        }
    }

    const previewKey = resource.trim() && action ? `${resource.trim()}:${action}` : null;

    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <div className="flex flex-col items-center justify-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Nuevo Permiso</h1>
                <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
                    <form onSubmit={(event) => void handleSubmit(event)} className="w-full">
                        <div className="grid grid-cols-2 gap-4">
                            {/* RECURSO */}
                            <div className="w-full max-[799px]:col-span-2 min-[800px]:col-span-2 min-[1000px]:col-span-1">
                                <Field label="Recurso" htmlFor="permissionResource">
                                    <Input
                                        id="permissionResource"
                                        value={resource}
                                        maxLength={50}
                                        onChange={(e) => setResource(e.target.value.toLowerCase())}
                                        placeholder="ej. asset-returns"
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                    <div className="text-xs text-gray-500 mt-1">
                                        Minúsculas, números y guiones. Máximo 50 caracteres.
                                    </div>
                                </Field>
                            </div>
                            {/* ACCION */}
                            <div className="w-full max-[799px]:col-span-2 min-[800px]:col-span-2 min-[1000px]:col-span-1">
                                <Field label="Acción" htmlFor="permissionAction">
                                    <Select
                                        id="permissionAction"
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                        value={action}
                                        onChange={(e) => setAction(e.target.value as PermissionAction | "")}
                                        required
                                    >
                                        <option value="">Seleccione la acción</option>
                                        {ACTION_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                            </div>
                            {/* DESCRIPCION */}
                            <div className="w-full col-span-2">
                                <Field label="Descripción" htmlFor="permissionDescription">
                                    <Textarea
                                        id="permissionDescription"
                                        value={description}
                                        maxLength={255}
                                        rows={3}
                                        onChange={(e) => setDescription(e.target.value)}
                                        placeholder="Texto que se muestra al asignar el permiso a un rol"
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                    <div className="text-xs text-gray-500 mt-1">No debe superar los 255 caracteres.</div>
                                </Field>
                            </div>
                        </div>

                        {/* PERMISOS INCLUIDOS (solo permiso de pantalla) */}
                        {isAccess && (
                            <div className="mt-6">
                                <PermissionChecklist
                                    permissions={basePermissions ?? []}
                                    selected={includedIds}
                                    onToggle={toggleIncluded}
                                    loading={loadingBase}
                                />
                            </div>
                        )}

                        {previewKey && (
                            <p className="mt-4 text-sm text-slate-600">
                                Clave del permiso: <code className="font-semibold text-slate-800">{previewKey}</code>
                            </p>
                        )}
                        <div className="flex flex-1 row-auto justify-center mt-6">
                            <Button type="submit" loading={submitting} className="w-60">
                                Guardar
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </RequirePermissions>
    );
}
