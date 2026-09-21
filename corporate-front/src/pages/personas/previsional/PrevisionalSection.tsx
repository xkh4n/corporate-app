import type { EmployerInheritance, PrevisionalInstitution } from "../../../types";
import { EmployerInheritanceNotice } from "./EmployerInheritanceNotice";
import { HealthFields } from "./HealthFields";
import { PensionFields } from "./PensionFields";
import type { PrevisionalFormState } from "./previsionalForm";

// Afiliacion previsional (AFP y salud) dentro del alta de colaborador: se
// define junto con el contrato porque ambos alimentan la misma liquidacion.
// Controlado por el padre (CrearPersona) -aca no hay estado propio.
export function PrevisionalSection({
  value,
  onChange,
  afps,
  healthInstitutions,
  employer,
  disabled,
}: {
  value: PrevisionalFormState;
  onChange: (next: PrevisionalFormState) => void;
  afps: PrevisionalInstitution[];
  healthInstitutions: PrevisionalInstitution[];
  // null = el usuario no puede leer la configuracion de la empresa: no se
  // muestra el aviso de CCAF/mutual (no bloquea el alta).
  employer: EmployerInheritance | null;
  disabled?: boolean;
}) {
  const patch = (partial: Partial<PrevisionalFormState>) => onChange({ ...value, ...partial });

  return (
    <fieldset disabled={disabled} className="mt-6 rounded-lg border border-slate-300 bg-white/60 p-4">
      <legend className="px-2 text-sm font-semibold text-gray-600">Previsión</legend>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-gray-600">Pensiones</h3>
          <PensionFields value={value} onChange={patch} afps={afps} />
        </div>
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-gray-600">Salud</h3>
          <HealthFields value={value} onChange={patch} healthInstitutions={healthInstitutions} />
        </div>
      </div>

      {employer && (
        <div className="mt-4">
          <EmployerInheritanceNotice employer={employer} />
        </div>
      )}
    </fieldset>
  );
}
