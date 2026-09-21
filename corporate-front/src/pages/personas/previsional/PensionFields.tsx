import { Field } from "../../../components/ui/Field";
import { Select } from "../../../components/ui/Select";
import type { PrevisionalInstitution, PrevisionalRegime, PrevisionalWorkerType } from "../../../types";
import { REGIME_OPTIONS, WORKER_TYPE_OPTIONS } from "./constants";
import type { PrevisionalFormState } from "./previsionalForm";

const FIELD_CLASS = "bg-zinc-100 focus:bg-indigo-100";

// Campos de la afiliacion de pensiones (regimen, tipo de trabajador, AFP).
// Los comparten la pantalla "Asignar AFP" y el alta de colaborador.
export function PensionFields({
  value,
  onChange,
  afps,
}: {
  value: Pick<PrevisionalFormState, "regime" | "workerType" | "afpId">;
  onChange: (partial: Partial<PrevisionalFormState>) => void;
  afps: PrevisionalInstitution[];
}) {
  return (
    <>
      <Field label="Régimen previsional" htmlFor="regime">
        <Select
          id="regime"
          value={value.regime}
          onChange={(event) => onChange({ regime: event.target.value as PrevisionalRegime })}
          className={FIELD_CLASS}
        >
          {REGIME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Tipo de trabajador" htmlFor="workerType">
        <Select
          id="workerType"
          value={value.workerType}
          onChange={(event) => onChange({ workerType: Number(event.target.value) as PrevisionalWorkerType })}
          className={FIELD_CLASS}
        >
          {WORKER_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      {/* Solo el régimen AFP lleva AFP; en IPS/SIP el backend descarta la AFP,
          así que el combo se oculta. */}
      {value.regime === "AFP" && (
        <Field label="AFP" htmlFor="afpId">
          <Select
            id="afpId"
            value={value.afpId}
            onChange={(event) => onChange({ afpId: event.target.value })}
            required
            className={FIELD_CLASS}
          >
            <option value="">Seleccione la AFP</option>
            {afps.map((afp) => (
              <option key={afp.id} value={afp.id}>
                {afp.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </>
  );
}
