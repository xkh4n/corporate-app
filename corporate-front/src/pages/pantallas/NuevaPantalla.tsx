import { useEffect, useMemo, useState } from "react";
import type { SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { IconPicker } from "../../components/IconPicker";
import { PermissionChecklist } from "../../components/PermissionChecklist";
import { Button, Field, Input, Select, Spinner, Textarea } from "../../components/ui";
import { showSuccessToast, showWarningToast } from "../../components/Toast";
import { useAuth } from "../../auth/useAuth";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { menuItemService, permissionService } from "../../services";
import type { MenuItem, MenuItemCreateInput, Permission, PermissionKey } from "../../types";
import { ACCESS_ACTION } from "../../types/permission";

// POST /menu-items exige "menu-items:create", y GET /menu-items (padres
// posibles y rutas en uso) lo acepta tambien. Crear el permiso de pantalla en
// la misma vista exige ademas "permissions:create": sin el, solo se ofrece
// elegir uno existente (GET /permissions esta abierto).
const REQUIRED_PERMISSIONS = ["menu-items:create"] as const;

// Mismos formatos que validan el backend (menuItem.controller.ts y
// permission.controller.ts).
const LINK_PATTERN = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const RESOURCE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

type ItemKind = "screen" | "folder";
type PermissionMode = "new" | "existing";

function permissionLabel(permission: Pick<Permission, "resource" | "action" | "description">): string {
    return permission.description ?? `${permission.resource}:${permission.action}`;
}

// "/assets/kardex" -> "assets-kardex": sugerencia de nombre para el permiso
// de pantalla, editable.
function slugFromLink(link: string): string {
    return link.replace(/^\/+/, "").replace(/\/+/g, "-");
}

// Ruta completa de una carpeta ("Gerencia de TI › Serv. Productivos ›
// Permisos") para distinguir carpetas con el mismo nombre en el combo.
function buildPath(item: MenuItem, byId: Map<number, MenuItem>): string {
    const labels: string[] = [];
    let current: MenuItem | undefined = item;
    const seen = new Set<number>();
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        labels.unshift(current.label);
        current = current.parentId !== null ? byId.get(current.parentId) : undefined;
    }
    return labels.join(" › ");
}

// implementedLinks: rutas con vista real en MODULE_PAGES (AppRoutes.tsx).
// Un item con una ruta fuera de esa lista muestra la pagina "en construccion".
export default function NuevaPantalla({ implementedLinks }: { implementedLinks: string[] }) {
    const navigate = useNavigate();
    const { can, refreshSession } = useAuth();
    const canCreatePermission = can("permissions:create");

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [permissions, setPermissions] = useState<Permission[]>([]);

    const [kind, setKind] = useState<ItemKind>("screen");
    const [label, setLabel] = useState("");
    const [parentId, setParentId] = useState("");
    const [link, setLink] = useState("");
    const [sortOrder, setSortOrder] = useState("10");
    const [icon, setIcon] = useState("");

    const [permissionMode, setPermissionMode] = useState<PermissionMode>(canCreatePermission ? "new" : "existing");
    const [existingPermissionId, setExistingPermissionId] = useState("");
    // Sugeridos a partir de la ruta y del nombre hasta que el usuario los edita.
    const [resource, setResource] = useState("");
    const [resourceTouched, setResourceTouched] = useState(false);
    const [description, setDescription] = useState("");
    const [descriptionTouched, setDescriptionTouched] = useState(false);
    const [includedIds, setIncludedIds] = useState<Set<number>>(new Set());

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [itemsRes, permissionsRes] = await Promise.all([
                    menuItemService.list({ limit: 1000 }),
                    permissionService.list({ limit: 1000, sortBy: "resource", sortOrder: "asc" }),
                ]);
                if (cancelled) return;
                setMenuItems(itemsRes.items);
                setPermissions(permissionsRes.items);
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

    const itemsById = useMemo(() => new Map(menuItems.map((item) => [item.id, item])), [menuItems]);
    // Solo las carpetas (items sin ruta) pueden tener hijos en el menu.
    const folders = useMemo(
        () =>
            menuItems
                .filter((item) => !item.link && item.isActive)
                .map((item) => ({ item, path: buildPath(item, itemsById) }))
                .sort((a, b) => a.path.localeCompare(b.path)),
        [menuItems, itemsById],
    );
    const usedLinks = useMemo(
        () => new Map(menuItems.filter((item) => item.link && item.isActive).map((item) => [item.link!, item.label])),
        [menuItems],
    );
    const availableLinks = implementedLinks.filter((candidate) => !usedLinks.has(candidate)).sort();
    const screenPermissions = permissions.filter((permission) => permission.action === ACCESS_ACTION);
    const basePermissions = permissions.filter((permission) => permission.action !== ACCESS_ACTION);
    const selectedExisting = screenPermissions.find((permission) => String(permission.id) === existingPermissionId);

    const trimmedLink = link.trim();
    const linkInUseBy = trimmedLink ? usedLinks.get(trimmedLink) : undefined;
    const linkWithoutPage = trimmedLink && LINK_PATTERN.test(trimmedLink) && !implementedLinks.includes(trimmedLink);
    const trimmedResource = resource.trim();
    const resourceIsBase = basePermissions.some((permission) => permission.resource === trimmedResource);

    function handleLabelChange(value: string) {
        setLabel(value);
        if (!descriptionTouched) setDescription(value.trim() ? `Pantalla: ${value.trim()}` : "");
    }

    function handleLinkChange(value: string) {
        setLink(value);
        if (!resourceTouched) setResource(slugFromLink(value.trim().toLowerCase()));
    }

    function toggleIncluded(id: number) {
        setIncludedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function resetForm() {
        setLabel("");
        setParentId("");
        setLink("");
        setSortOrder("10");
        setIcon("");
        setExistingPermissionId("");
        setResource("");
        setResourceTouched(false);
        setDescription("");
        setDescriptionTouched(false);
        setIncludedIds(new Set());
        setPermissionMode(canCreatePermission ? "new" : "existing");
    }

    function validateMenuItem(): Omit<MenuItemCreateInput, "permissionKey"> {
        const trimmedLabel = label.trim();
        if (!trimmedLabel || trimmedLabel.length > 100) {
            throw createValidationError("El nombre es obligatorio (máximo 100 caracteres)");
        }
        if (menuItems.some((item) => item.label === trimmedLabel)) {
            throw createValidationError(`Ya existe un ítem de menú llamado "${trimmedLabel}"`);
        }
        const order = Number(sortOrder);
        if (!Number.isInteger(order)) {
            throw createValidationError("El orden debe ser un número entero");
        }
        const input: Omit<MenuItemCreateInput, "permissionKey"> = { label: trimmedLabel, sortOrder: order };
        if (icon) input.icon = icon;
        if (parentId) input.parentId = Number(parentId);

        if (kind === "screen") {
            if (!LINK_PATTERN.test(trimmedLink)) {
                throw createValidationError("La ruta debe tener el formato /segmento/segmento (minúsculas, números y guiones)");
            }
            if (linkInUseBy) {
                throw createValidationError(`La ruta ${trimmedLink} ya la usa "${linkInUseBy}"`);
            }
            input.link = trimmedLink;
        }
        return input;
    }

    function validateNewPermission() {
        if (trimmedResource.length < 2 || trimmedResource.length > 50 || !RESOURCE_PATTERN.test(trimmedResource)) {
            throw createValidationError(
                "El nombre del permiso debe ir en minúsculas, separado por guiones y sin espacios (ej. asset-kardex-view)",
            );
        }
        if (screenPermissions.some((permission) => permission.resource === trimmedResource)) {
            throw createValidationError(`Ya existe el permiso "${trimmedResource}:access"; elíjalo como existente`);
        }
        if (description.trim().length < 3) {
            throw createValidationError("La descripción del permiso es obligatoria (mínimo 3 caracteres)");
        }
        if (includedIds.size === 0) {
            throw createValidationError("El permiso de pantalla debe incluir al menos un permiso");
        }
    }

    async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitting(true);
        // Permiso creado en ESTE envio: si despues falla el alta del item de
        // menu, se deja elegido como "existente" para no duplicarlo al reintentar.
        let createdPermission: Permission | null = null;
        try {
            const input = validateMenuItem();
            let permissionKey: PermissionKey | undefined;

            if (kind === "screen") {
                if (permissionMode === "new") {
                    validateNewPermission();
                    createdPermission = await permissionService.create({
                        resource: trimmedResource,
                        action: ACCESS_ACTION,
                        description: description.trim(),
                        includedPermissionIds: [...includedIds],
                    });
                    setPermissions((current) => [...current, createdPermission!]);
                    permissionKey = `${createdPermission.resource}:${ACCESS_ACTION}`;
                } else {
                    if (!selectedExisting) {
                        throw createValidationError("Debe seleccionar el permiso de pantalla");
                    }
                    permissionKey = `${selectedExisting.resource}:${ACCESS_ACTION}`;
                }
            }

            const created = await menuItemService.create({ ...input, ...(permissionKey ? { permissionKey } : {}) });
            setMenuItems((current) => [...current, created]);
            // Recarga /auth/me y /auth/menu: el item nuevo aparece en el
            // sidebar de quien lo creo (si su rol lo alcanza) sin recargar.
            await refreshSession();
            showSuccessToast(
                kind === "screen"
                    ? `Pantalla "${created.label}" creada. La verán los roles que tengan el permiso ${permissionKey}.`
                    : `Carpeta "${created.label}" creada. Se muestra cuando tenga al menos una pantalla visible.`,
            );
            resetForm();
        } catch (error) {
            if (createdPermission) {
                setPermissionMode("existing");
                setExistingPermissionId(String(createdPermission.id));
                showWarningToast(
                    `El permiso "${createdPermission.resource}:access" ya quedó creado y se dejó seleccionado. Corrija el error y vuelva a guardar.`,
                );
            }
            handleError(error, navigate);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <div className="flex flex-col items-center justify-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Nueva Pantalla</h1>
                {loading ? (
                    <div className="flex justify-center py-12">
                        <Spinner />
                    </div>
                ) : (
                    <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
                        <form onSubmit={(event) => void handleSubmit(event)} className="w-full space-y-6">
                            {/* TIPO */}
                            <fieldset className="flex flex-wrap gap-4 text-sm text-slate-700">
                                <legend className="mb-2 font-semibold">Tipo de ítem</legend>
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="kind" checked={kind === "screen"} onChange={() => setKind("screen")} />
                                    Pantalla (abre una vista)
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="kind" checked={kind === "folder"} onChange={() => setKind("folder")} />
                                    Carpeta (agrupa otros ítems)
                                </label>
                            </fieldset>

                            <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-2">
                                <Field label="Nombre en el menú" htmlFor="menuLabel">
                                    <Input
                                        id="menuLabel"
                                        value={label}
                                        maxLength={100}
                                        onChange={(e) => handleLabelChange(e.target.value)}
                                        placeholder="ej. Kardex de Activos"
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                </Field>
                                <Field label="Depende de" htmlFor="menuParent">
                                    <Select
                                        id="menuParent"
                                        value={parentId}
                                        onChange={(e) => setParentId(e.target.value)}
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    >
                                        <option value="">(Raíz del menú)</option>
                                        {folders.map(({ item, path }) => (
                                            <option key={item.id} value={item.id}>
                                                {path}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                                {kind === "screen" && (
                                    <Field label="Ruta" htmlFor="menuLink">
                                        <Input
                                            id="menuLink"
                                            value={link}
                                            maxLength={255}
                                            list="implementedLinks"
                                            onChange={(e) => handleLinkChange(e.target.value)}
                                            placeholder="ej. /assets/kardex"
                                            className="bg-zinc-100 focus:bg-indigo-100"
                                        />
                                        <datalist id="implementedLinks">
                                            {availableLinks.map((candidate) => (
                                                <option key={candidate} value={candidate} />
                                            ))}
                                        </datalist>
                                        {linkInUseBy ? (
                                            <p className="mt-1 text-xs text-rose-700">Esta ruta ya la usa «{linkInUseBy}».</p>
                                        ) : linkWithoutPage ? (
                                            <p className="mt-1 text-xs text-amber-700">
                                                Esta ruta todavía no tiene una vista implementada: el menú mostrará una
                                                página «en construcción».
                                            </p>
                                        ) : (
                                            <p className="mt-1 text-xs text-gray-500">
                                                Se sugieren las rutas con vista implementada que aún no están en el menú.
                                            </p>
                                        )}
                                    </Field>
                                )}
                                <Field label="Orden" htmlFor="menuSortOrder">
                                    <Input
                                        id="menuSortOrder"
                                        type="number"
                                        step={1}
                                        value={sortOrder}
                                        onChange={(e) => setSortOrder(e.target.value)}
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">Menor número = más arriba dentro de su carpeta.</p>
                                </Field>
                            </div>

                            {/* ICONO */}
                            <div>
                                <h2 className="mb-2 text-sm font-semibold text-slate-700">Icono</h2>
                                <IconPicker value={icon} onChange={setIcon} />
                            </div>

                            {/* PERMISO DE PANTALLA */}
                            {kind === "screen" && (
                                <div className="space-y-4">
                                    <fieldset className="flex flex-wrap gap-4 text-sm text-slate-700">
                                        <legend className="mb-2 font-semibold">Permiso de pantalla</legend>
                                        <label className={`flex items-center gap-2 ${canCreatePermission ? "" : "opacity-50"}`}>
                                            <input
                                                type="radio"
                                                name="permissionMode"
                                                checked={permissionMode === "new"}
                                                disabled={!canCreatePermission}
                                                onChange={() => setPermissionMode("new")}
                                            />
                                            Crear uno nuevo
                                        </label>
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="radio"
                                                name="permissionMode"
                                                checked={permissionMode === "existing"}
                                                onChange={() => setPermissionMode("existing")}
                                            />
                                            Usar uno existente
                                        </label>
                                        {!canCreatePermission && (
                                            <span className="w-full text-xs text-slate-500">
                                                Crear permisos requiere «Crear Permiso» (permissions:create).
                                            </span>
                                        )}
                                    </fieldset>

                                    {permissionMode === "new" ? (
                                        <>
                                            <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-2">
                                                <Field label="Nombre del permiso" htmlFor="screenResource">
                                                    <Input
                                                        id="screenResource"
                                                        value={resource}
                                                        maxLength={50}
                                                        onChange={(e) => {
                                                            setResource(e.target.value.toLowerCase());
                                                            setResourceTouched(true);
                                                        }}
                                                        placeholder="ej. asset-kardex-view"
                                                        className="bg-zinc-100 focus:bg-indigo-100"
                                                    />
                                                    {trimmedResource && (
                                                        <p className="mt-1 text-xs text-slate-600">
                                                            Clave: <code className="font-semibold">{trimmedResource}:access</code>
                                                        </p>
                                                    )}
                                                    {resourceIsBase && (
                                                        <p className="mt-1 text-xs text-amber-700">
                                                            Ya hay permisos base con ese nombre de recurso; conviene uno
                                                            distinto (ej. agregar «-view») para no confundirlos.
                                                        </p>
                                                    )}
                                                </Field>
                                                <Field label="Descripción del permiso" htmlFor="screenDescription">
                                                    <Textarea
                                                        id="screenDescription"
                                                        value={description}
                                                        maxLength={255}
                                                        rows={2}
                                                        onChange={(e) => {
                                                            setDescription(e.target.value);
                                                            setDescriptionTouched(true);
                                                        }}
                                                        className="bg-zinc-100 focus:bg-indigo-100"
                                                    />
                                                </Field>
                                            </div>
                                            <PermissionChecklist
                                                permissions={basePermissions}
                                                selected={includedIds}
                                                onToggle={toggleIncluded}
                                            />
                                        </>
                                    ) : (
                                        <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-2">
                                            <Field label="Permiso existente" htmlFor="existingPermission">
                                                <Select
                                                    id="existingPermission"
                                                    value={existingPermissionId}
                                                    onChange={(e) => setExistingPermissionId(e.target.value)}
                                                    className="bg-zinc-100 focus:bg-indigo-100"
                                                >
                                                    <option value="">Seleccione un permiso de pantalla</option>
                                                    {screenPermissions.map((permission) => (
                                                        <option key={permission.id} value={permission.id}>
                                                            {permissionLabel(permission)} ({permission.resource}:access)
                                                        </option>
                                                    ))}
                                                </Select>
                                            </Field>
                                            {selectedExisting && (
                                                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                                                    <p className="font-medium text-emerald-900">Incluye:</p>
                                                    {selectedExisting.includedPermissions?.length ? (
                                                        <ul className="mt-1 list-disc pl-5 text-emerald-800">
                                                            {selectedExisting.includedPermissions.map((included) => (
                                                                <li key={included.id}>{permissionLabel(included)}</li>
                                                            ))}
                                                        </ul>
                                                    ) : (
                                                        <p className="mt-1 text-emerald-800">Ningún permiso todavía.</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="flex justify-center">
                                <Button type="submit" loading={submitting} className="w-60">
                                    Guardar
                                </Button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </RequirePermissions>
    );
}
