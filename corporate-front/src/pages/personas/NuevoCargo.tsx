import { useState, useEffect } from "react";
import type { SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Field, Button, Input, Textarea, Select, Spinner } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { IsParagraph } from "../../lib/Validations";
import { showSuccessToast } from "../../components/Toast";
import type { Role, PositionCreateInput, CostCenter } from "../../types";
import { roleService, positionService, costCenterService } from "../../services";

const REQUIRED_PERMISSIONS = ["roles:read", "employees:create"] as const;

// Convierte un textarea de "un item por linea" en el array que espera el
// backend (responsibilities/technicalSkills/softSkills, ver
// position.controller.ts) -misma idea que un tag input, sin el componente.
function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export default function NuevoCargo() {
    const navigate = useNavigate();
    const [catalogsLoading, setCatalogsLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [roles, setRoles] = useState<Role[]>([]);

    const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
    const [costCenterId, setCostCenterId] = useState("");

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [responsibilities, setResponsibilities] = useState("");
    const [technicalSkills, setTechnicalSkills] = useState("");
    const [softSkills, setSoftSkills] = useState("");
    const [reportsTo, setReportsTo] = useState("");
    const [supervises, setSupervises] = useState("");
    const [selectedRole, setSelectedRole] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const result = await roleService.list({ limit: 1000 });
                const [costCentersRes] = await Promise.all([
                    costCenterService.list({ limit: 1000 }),
                ]);
                if (cancelled) return;
                setCostCenters(costCentersRes.items);
                setRoles(result.items);
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

    // El Centro de Costo elegido es solo un filtro para el select de Rol -no
    // viaja al backend (Position no guarda costCenterId, ver position.types.ts):
    // el nombre del rol ya trae el codigo del centro de costo antepuesto
    // (buildRoleName en NuevoRole.tsx), asi que roleId alcanza para saber a
    // que area corresponde.
    const selectedCostCenter = costCenters.find((item) => String(item.id) === costCenterId);
    const rolesForCostCenter = selectedCostCenter
        ? roles.filter((role) => role.name.startsWith(`${selectedCostCenter.code}-`))
        : [];

    function handleCostCenterChange(value: string) {
        setCostCenterId(value);
        setSelectedRole("");
    }

    function resetForm() {
        setSubmitting(false);
        setTitle("");
        setDescription("");
        setResponsibilities("");
        setTechnicalSkills("");
        setSoftSkills("");
        setReportsTo("");
        setSupervises("");
        setCostCenterId("");
        setSelectedRole("");
    }

    function validate(): PositionCreateInput {
        if (!title.trim() || !IsParagraph(title.trim())) {
            throw createValidationError("El nombre del Cargo no es válido");
        }
        if (!description.trim() || !IsParagraph(description.trim())) {
            throw createValidationError("La descripción no es válida");
        }
        const responsibilitiesList = linesToList(responsibilities);
        if (responsibilitiesList.length === 0) {
            throw createValidationError("Debe indicar al menos una función");
        }
        if (!costCenterId) {
            throw createValidationError("Debe seleccionar el Centro de Costo");
        }
        if (!selectedRole) {
            throw createValidationError("Debe seleccionar el Rol asociado al cargo");
        }

        return {
            title: title.trim(),
            description: description.trim(),
            responsibilities: responsibilitiesList,
            technicalSkills: linesToList(technicalSkills),
            softSkills: linesToList(softSkills),
            reportsTo: reportsTo.trim() || undefined,
            supervises: supervises.trim() || undefined,
            roleId: Number(selectedRole),
        };
    }

    async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitting(true);
        try {
            const newPosition = validate();
            await positionService.create(newPosition);
            showSuccessToast("Cargo creado exitosamente");
            resetForm();
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <div className="flex flex-col items-center justify-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Nuevo Cargo</h1>
                {catalogsLoading ? (
                    <div className="flex justify-center py-12">
                        <Spinner />
                    </div>
                ) : (
                    <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8">
                        <form onSubmit={(event) => void handleSubmit(event)} className="w-full">
                            <div className="grid grid-cols-1 max-[799px]:grid-cols-1 min-[800px]:grid-cols-6 min-[1000px]:grid-cols-8 min-[1200px]:grid-cols-10 min-[1400px]:grid-cols-12 gap-4">
                                <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-6">
                                    {/* NOMBRE DEL CARGO */}
                                    <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-6">
                                        <Field label="Nombre del Cargo" htmlFor="titlePosition">
                                            <Input
                                                id="titlePosition"
                                                value={title}
                                                maxLength={150}
                                                onChange={(e) => setTitle(e.target.value)}
                                                className="bg-zinc-100 focus:bg-indigo-100"
                                            />
                                        </Field>
                                    </div>
                                    {/* CENTRO DE COSTO */}
                                    <div className="w-full max-[799px]:col-span-2 min-[800px]:col-span-2 min-[1000px]:col-span-1">
                                        <Field label="Centro de Costo" htmlFor="costCenterId">
                                            <Select
                                                id="costCenterId"
                                                className="bg-zinc-100 focus:bg-indigo-100"
                                                value={costCenterId}
                                                onChange={(e) => handleCostCenterChange(e.target.value)}
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
                                    {/* ROL ASOCIADO */}
                                    <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-6">
                                        <Field label="Rol Asociado" htmlFor="rolePosition">
                                            <Select
                                                id="rolePosition"
                                                className="bg-zinc-100 focus:bg-indigo-100"
                                                value={selectedRole}
                                                onChange={(e) => setSelectedRole(e.target.value)}
                                                disabled={!costCenterId}
                                                required
                                            >
                                                <option value="">
                                                    {costCenterId ? "Seleccione un Rol" : "Primero seleccione el Centro de Costo"}
                                                </option>
                                                {rolesForCostCenter.map((role) => (
                                                    <option key={role.id} value={role.id}>
                                                        {role.name}
                                                    </option>
                                                ))}
                                            </Select>
                                        </Field>
                                    </div>
                                </div>
                                {/* DESCRIPCION */}
                                <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-6">
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
                                {/* FUNCIONES */}
                                <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-6">
                                    <Field label="Funciones (una por línea)" htmlFor="responsibilitiesPosition">
                                        <Textarea
                                            id="responsibilitiesPosition"
                                            value={responsibilities}
                                            rows={4}
                                            onChange={(e) => setResponsibilities(e.target.value)}
                                            className="bg-zinc-100 focus:bg-indigo-100"
                                        />
                                    </Field>
                                </div>
                                {/* HABILIDADES TECNICAS */}
                                <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-5 min-[1400px]:col-span-6">
                                    <Field label="Habilidades Técnicas (una por línea)" htmlFor="technicalSkillsPosition">
                                        <Textarea
                                            id="technicalSkillsPosition"
                                            value={technicalSkills}
                                            rows={4}
                                            onChange={(e) => setTechnicalSkills(e.target.value)}
                                            className="bg-zinc-100 focus:bg-indigo-100"
                                        />
                                    </Field>
                                </div>
                                {/* HABILIDADES BLANDAS */}
                                <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-5 min-[1400px]:col-span-6">
                                    <Field label="Habilidades Blandas (una por línea)" htmlFor="softSkillsPosition">
                                        <Textarea
                                            id="softSkillsPosition"
                                            value={softSkills}
                                            rows={4}
                                            onChange={(e) => setSoftSkills(e.target.value)}
                                            className="bg-zinc-100 focus:bg-indigo-100"
                                        />
                                    </Field>
                                </div>
                                <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-6">
                                    {/* REPORTA A */}
                                    <div className="w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-5 min-[1400px]:col-span-6">
                                        <Field label="Reporta a" htmlFor="reportsToPosition">
                                            <Input
                                                id="reportsToPosition"
                                                value={reportsTo}
                                                maxLength={255}
                                                onChange={(e) => setReportsTo(e.target.value)}
                                                className="bg-zinc-100 focus:bg-indigo-100"
                                            />
                                        </Field>
                                    </div>
                                    {/* SUPERVISA A */}
                                    <div className="w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-5 min-[1400px]:col-span-6">
                                        <Field label="Supervisa a" htmlFor="supervisesPosition">
                                            <Input
                                                id="supervisesPosition"
                                                value={supervises}
                                                maxLength={255}
                                                onChange={(e) => setSupervises(e.target.value)}
                                                className="bg-zinc-100 focus:bg-indigo-100"
                                            />
                                        </Field>
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-1 row-auto justify-center mt-6">
                                <Button type="submit" loading={submitting} className="w-full sm:w-60">
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
