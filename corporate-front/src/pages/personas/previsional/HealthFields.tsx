import { Field } from "../../../components/ui/Field";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import type { HealthPlanCurrency, PrevisionalInstitution } from "../../../types";
import { HEALTH_CURRENCY_OPTIONS } from "./constants";
import { isIsapre, type PrevisionalFormState } from "./previsionalForm";

const FIELD_CLASS = "bg-zinc-100 focus:bg-indigo-100";

// Campos de la afiliacion de salud (FONASA o Isapre con su plan pactado).
// Los comparten la pantalla "Asignar Salud" y el alta de colaborador.
export function HealthFields({
  value,
  onChange,
  healthInstitutions,
}: {
  value: Pick<PrevisionalFormState, "healthInstitutionId" | "healthFun" | "healthCurrency" | "healthAgreedAmount">;
  onChange: (partial: Partial<PrevisionalFormState>) => void;
  healthInstitutions: PrevisionalInstitution[];
}) {
  const isapre = isIsapre(value.healthInstitutionId, healthInstitutions);

  return (
    <>
      <Field label="Institución de salud" htmlFor="institutionId">
        <Select
          id="institutionId"
          value={value.healthInstitutionId}
          onChange={(event) => onChange({ healthInstitutionId: event.target.value })}
          required
          className={FIELD_CLASS}
        >
          <option value="">Seleccione FONASA o una Isapre</option>
          {healthInstitutions.map((institution) => (
            <option key={institution.id} value={institution.id}>
              {institution.name}
            </option>
          ))}
        </Select>
      </Field>

      {isapre && (
        <>
          <Field label="Número de FUN (opcional)" htmlFor="fun">
            <Input
              id="fun"
              value={value.healthFun}
              maxLength={16}
              onChange={(event) => onChange({ healthFun: event.target.value })}
              className={FIELD_CLASS}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Moneda del plan pactado" htmlFor="currency">
              <Select
                id="currency"
                value={value.healthCurrency}
                onChange={(event) => onChange({ healthCurrency: Number(event.target.value) as HealthPlanCurrency })}
                className={FIELD_CLASS}
              >
                {HEALTH_CURRENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Monto del plan pactado" htmlFor="agreedAmount">
              <Input
                id="agreedAmount"
                type="number"
                min={0}
                step={value.healthCurrency === 2 ? 0.0001 : 1}
                value={value.healthAgreedAmount}
                onChange={(event) => onChange({ healthAgreedAmount: event.target.value })}
                placeholder={value.healthCurrency === 2 ? "Ej: 4.0241" : "Ej: 85000"}
                required
                className={FIELD_CLASS}
              />
            </Field>
          </div>
        </>
      )}
    </>
  );
}
