import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../../components/RequirePermissions";
import { Button } from "../../../components/ui/Button";
import { Spinner } from "../../../components/ui/Spinner";
import { showSuccessToast } from "../../../components/Toast";
import { handleError } from "../../../lib/Errors";
import { createValidationError } from "../../../lib/Errors/CustomError";
import { employeeService, previsionalService } from "../../../services";
import type { Employee, EmployerInheritance, PrevisionalInstitution, PrevisionalProfileView } from "../../../types";
import { EmployeePicker } from "./EmployeePicker";
import { EmployerInheritanceNotice } from "./EmployerInheritanceNotice";
import { PensionFields } from "./PensionFields";
import { emptyPrevisionalForm, toPensionInput, type PrevisionalFormState } from "./previsionalForm";

// employees:read para poblar el combo de colaboradores, previsional-
// institutions:read para el de AFP, previsional-profiles:read/update para
// ver y guardar la afiliacion (dato sensible, admin-only por defecto).
const REQUIRED_PERMISSIONS = [
  "employees:read",
  "previsional-institutions:read",
  "previsional-profiles:read",
  "previsional-profiles:update",
] as const;

export default function AsignarAfpPage() {
  const navigate = useNavigate();

  const [catalogsLoading, setCatalogsLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [afps, setAfps] = useState<PrevisionalInstitution[]>([]);

  const [employeeId, setEmployeeId] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [employer, setEmployer] = useState<EmployerInheritance | null>(null);

  const [pension, setPension] = useState<PrevisionalFormState>(() => emptyPrevisionalForm());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [employeesRes, afpsRes] = await Promise.all([
          employeeService.list({ limit: 1000 }),
          previsionalService.listInstitutions("AFP", { limit: 100 }),
        ]);
        if (cancelled) return;
        setEmployees(employeesRes.items);
        setAfps(afpsRes.items);
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

  // Vuelca en el formulario lo que el colaborador ya tiene asignado (o los
  // valores por defecto si todavia no tiene perfil).
  function applyView(view: PrevisionalProfileView) {
    setEmployer(view.employer);
    setPension({
      ...emptyPrevisionalForm(),
      regime: view.profile?.regime ?? "AFP",
      workerType: view.profile?.workerType ?? 0,
      afpId: view.profile?.afpInstitutionId ? String(view.profile.afpInstitutionId) : "",
    });
  }

  async function handleEmployeeChange(value: string) {
    setEmployeeId(value);
    setEmployer(null);
    if (!value) return;

    setProfileLoading(true);
    try {
      applyView(await previsionalService.getProfile(Number(value)));
    } catch (error) {
      setEmployeeId("");
      handleError(error, navigate);
    } finally {
      setProfileLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (!employeeId) throw createValidationError("Debe seleccionar el colaborador");
      const view = await previsionalService.assignPension(Number(employeeId), toPensionInput(pension));
      applyView(view);
      showSuccessToast("Previsión de pensiones guardada exitosamente");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center justify-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Asignar AFP</h1>

        {catalogsLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <div className="w-full max-w-3xl mx-auto sm:px-6 lg:px-8">
            <form onSubmit={(event) => void handleSubmit(event)} className="w-full flex flex-col gap-4">
              <EmployeePicker
                employees={employees}
                value={employeeId}
                onChange={(value) => void handleEmployeeChange(value)}
                disabled={profileLoading || submitting}
              />

              {profileLoading && (
                <div className="flex justify-center py-4">
                  <Spinner />
                </div>
              )}

              {employeeId && !profileLoading && (
                <>
                  <PensionFields
                    value={pension}
                    onChange={(partial) => setPension((current) => ({ ...current, ...partial }))}
                    afps={afps}
                  />

                  {employer && <EmployerInheritanceNotice employer={employer} />}

                  <div className="flex justify-center mt-2">
                    <Button type="submit" loading={submitting} className="w-full sm:w-60">
                      Guardar
                    </Button>
                  </div>
                </>
              )}
            </form>
          </div>
        )}
      </div>
    </RequirePermissions>
  );
}
