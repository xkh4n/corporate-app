import { useState, useEffect } from "react";
import type { SubmitEvent } from "react";
import { RequirePermissions } from "../../components/RequirePermissions";
import { useNavigate } from "react-router-dom";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { IsParagraph } from "../../lib/Validations";
import { Field, Button, Input, Textarea, Spinner, Select } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import type { RoleCreateInput, CostCenter } from "../../types";
import { roleService, costCenterService } from "../../services";


const REQUIRED_PERMISSIONS = ["roles:create", "permissions:read"] as const;

// Un mismo cargo (ej. "Comprador") puede existir en centros de costo
// distintos con permisos totalmente distintos (Logistica vs Sistemas) -el
// codigo del centro de costo va antepuesto al nombre del rol para poder
// distinguirlos a simple vista en cualquier combo de roles (ej. el select
// "Rol Asociado" en NuevoCargo.tsx), sin tener que abrir el rol para saber a
// que area pertenece.
function buildRoleName(costCenterCode: number, roleName: string): string {
    return `${costCenterCode}-${roleName}`;
}

export default function NuevoRole() {
    const [catalogsLoading, setCatalogsLoading] = useState(true);
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);

    const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
    const [costCenterId, setCostCenterId] = useState("");
    const [role, setRole] = useState("");
    const [description, setDescription] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [costCentersRes] = await Promise.all([
                    costCenterService.list({ limit: 1000 }),
                ]);
                if (cancelled) return;
                setCostCenters(costCentersRes.items);
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

    function resetForm() {
        setSubmitting(false);
        setRole("");
        setDescription("");
        setCostCenterId("");
    }

    function validate(): RoleCreateInput {
        if (!costCenterId) {
            throw createValidationError("Debe seleccionar el Centro de Costo");
        }
        const costCenter = costCenters.find((item) => String(item.id) === costCenterId);
        if (!costCenter) {
            throw createValidationError("El Centro de Costo seleccionado no es válido");
        }
        if (!role.trim() || !IsParagraph(role.trim())) {
            throw createValidationError("El nombre del Role no es válido");
        }
        if (!description.trim() || !IsParagraph(description.trim())) {
            throw createValidationError("La descripción no es válida");
        }

        const name = buildRoleName(costCenter.code, role.trim());
        // roles.name es VARCHAR(50) en el backend (ver role.model.ts) -el
        // prefijo del centro de costo cuenta contra ese limite, no alcanza
        // con validar maxLength solo sobre el input del nombre.
        if (name.length > 50) {
            throw createValidationError("El nombre del Role (incluido el prefijo del Centro de Costo) supera los 50 caracteres");
        }

        return {
            name,
            description: description.trim()
        };
    }

    async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitting(true);
        try {
            const newRole = validate();
            await roleService.create(newRole);
            showSuccessToast("Role creado exitosamente");
            resetForm();
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setSubmitting(false);
        }
    }


    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <div className="flex flex-col items-center justify-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Nuevo Role</h1>
                {catalogsLoading ? (
                    <div className="flex justify-center py-12">
                        <Spinner />
                    </div>
                ) : (
                    <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
                        <form onSubmit={(event) => void handleSubmit(event)} className="w-full">
                            <div className="grid grid-cols-2 gap-4">
                                {/* CENTRO DE COSTO */}
                                <div className="w-full max-[799px]:col-span-2 min-[800px]:col-span-2 min-[1000px]:col-span-1">
                                    <Field label="Centro de Costo" htmlFor="costCenterId">
                                        <Select
                                            id="costCenterId"
                                            className="bg-zinc-100 focus:bg-indigo-100"
                                            value={costCenterId}
                                            onChange={(e) => setCostCenterId(e.target.value)}
                                            required
                                        >
                                            <option value="">Seleccione el centro de costo</option>
                                            {costCenters.map((costCenter) => (
                                                <option key={costCenter.id} value={costCenter.id}>
                                                {costCenter.name}
                                                </option>
                                            ))}
                                        </Select>
                                    </Field>
                                </div>
                                {/* NOMBRE DEL ROLE */}
                                <div className="w-full max-[799px]:col-span-2 min-[800px]:col-span-2 min-[1000px]:col-span-1">
                                    <Field label="Nombre del Role" htmlFor="newRole">
                                        <Input
                                            id="newRole"
                                            value={role}
                                            maxLength={50}
                                            onChange={(e) => setRole(e.target.value)}
                                            placeholder="Máximo 50 caracteres"
                                            className="bg-zinc-100 focus:bg-indigo-100"
                                        />
                                    </Field>
                                </div>
                                {/* DESCRIPCION */}
                                <div className="w-full max-[799px]:col-span-2 min-[800px]:col-span-2  min-[1000px]:col-span-2">
                                    <Field label="Descripción" htmlFor="descriptionPosition">
                                        <Textarea
                                            id="descriptionPosition"
                                            value={description}
                                            maxLength={2000}
                                            rows={4}
                                            onChange={(e) => setDescription(e.target.value)}
                                            className="bg-zinc-100 focus:bg-indigo-100"
                                        />
                                    </Field>
                                </div>
                            </div>
                            <div className="flex flex-1 row-auto justify-center mt-6">
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
