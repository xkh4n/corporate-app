import { Field } from "../../../components/ui/Field";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import type { EmployeeContractType, GratificationPaymentMode, GratificationType } from "../../../types";
import {
  GRATIFICATION_TYPE_LABELS,
  companyAdvanceAmount,
  MONTH_LABELS,
  PAYMENT_MODE_LABELS,
  applyGratificationType,
  applyPaymentMode,
  gratificationSummary,
  lockedFields,
  suggestedMonthlyAdvance,
  syncCompanyAdvance,
  type ContractFormState,
} from "./contractForm";

const FIELD_CLASS = "bg-zinc-100 focus:bg-indigo-100";
const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

// Contrato del colaborador: sueldo base y forma de pago de la gratificacion
// legal. Controlado por el padre (CrearPersona) -aca no hay estado propio.
// companyAdvancePercentage es el % de anticipo mensual que define la empresa
// (Configuracion de Remuneraciones): con el se calcula en pesos el anticipo a
// partir del sueldo base, mientras el usuario no escriba un monto propio.
export function ContractSection({
  value,
  onChange,
  companyAdvancePercentage = null,
  disabled,
}: {
  value: ContractFormState;
  onChange: (next: ContractFormState) => void;
  companyAdvancePercentage?: number | null;
  disabled?: boolean;
}) {
  const locked = lockedFields(value.gratificationType);
  // Todo cambio pasa por syncCompanyAdvance: asi el anticipo sigue al sueldo (y
  // al modo de pago) sin que cada campo tenga que acordarse de recalcularlo.
  const emit = (next: ContractFormState) => onChange(syncCompanyAdvance(next, companyAdvancePercentage));
  const patch = (partial: Partial<ContractFormState>) => emit({ ...value, ...partial });
  const summary = gratificationSummary(value);
  const suggestedAdvance = suggestedMonthlyAdvance(value);
  const monthlyCapFactor = value.capEnabled ? Number(value.capFactor) / 12 : NaN;
  const suggestedFromCompany =
    companyAdvancePercentage !== null ? companyAdvanceAmount(value.baseSalary, companyAdvancePercentage) : null;

  return (
    <fieldset disabled={disabled} className="mt-6 rounded-lg border border-slate-300 bg-white/60 p-4">
      <legend className="px-2 text-sm font-semibold text-gray-600">Contrato y remuneración</legend>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Tipo de contrato" htmlFor="contractType">
          <Select
            id="contractType"
            value={value.contractType}
            onChange={(e) => patch({ contractType: e.target.value as EmployeeContractType })}
            className={FIELD_CLASS}
          >
            <option value="INDEFINIDO">Indefinido</option>
            <option value="PLAZO_FIJO">Plazo fijo</option>
          </Select>
        </Field>
        <Field label="Fecha de inicio" htmlFor="contractStart">
          <Input
            id="contractStart"
            type="date"
            value={value.startDate}
            onChange={(e) => patch({ startDate: e.target.value })}
            required
            className={FIELD_CLASS}
          />
        </Field>
        <Field
          label={value.contractType === "PLAZO_FIJO" ? "Fecha de término" : "Fecha de término (opcional)"}
          htmlFor="contractEnd"
        >
          <Input
            id="contractEnd"
            type="date"
            value={value.endDate}
            min={value.startDate || undefined}
            onChange={(e) => patch({ endDate: e.target.value })}
            required={value.contractType === "PLAZO_FIJO"}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Sueldo base mensual ($)" htmlFor="baseSalary">
          <Input
            id="baseSalary"
            type="number"
            min={1}
            step={1}
            value={value.baseSalary}
            onChange={(e) => patch({ baseSalary: e.target.value })}
            placeholder="Ej: 1200000"
            required
            className={FIELD_CLASS}
          />
        </Field>
      </div>

      <h3 className="mt-6 mb-3 text-sm font-semibold text-gray-600">Gratificación legal</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Field label="Sistema de gratificación" htmlFor="gratificationType">
            <Select
              id="gratificationType"
              value={value.gratificationType}
              onChange={(e) => emit(applyGratificationType(value, e.target.value as GratificationType))}
              className={FIELD_CLASS}
            >
              {(Object.keys(GRATIFICATION_TYPE_LABELS) as GratificationType[]).map((type) => (
                <option key={type} value={type}>
                  {GRATIFICATION_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Porcentaje (%)" htmlFor="gratificationPercentage">
          <Input
            id="gratificationPercentage"
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={value.percentage}
            onChange={(e) => patch({ percentage: e.target.value })}
            disabled={locked.percentage}
            required
            className={`${FIELD_CLASS} disabled:bg-zinc-200`}
          />
        </Field>
        <Field label="Tope (veces el IMM)" htmlFor="gratificationCap">
          <div className="flex items-center gap-2">
            <input
              id="gratificationCapEnabled"
              type="checkbox"
              checked={value.capEnabled}
              onChange={(e) => patch({ capEnabled: e.target.checked, capFactor: e.target.checked ? value.capFactor : "" })}
              disabled={locked.cap}
              aria-label="Aplicar tope"
            />
            <Input
              id="gratificationCap"
              type="number"
              min={0}
              step={0.01}
              value={value.capFactor}
              onChange={(e) => patch({ capFactor: e.target.value })}
              disabled={locked.cap || !value.capEnabled}
              placeholder="Sin tope"
              className={`${FIELD_CLASS} disabled:bg-zinc-200`}
            />
          </div>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Forma de pago" htmlFor="gratificationPaymentMode">
            <Select
              id="gratificationPaymentMode"
              value={value.paymentMode}
              onChange={(e) => emit(applyPaymentMode(value, e.target.value as GratificationPaymentMode))}
              className={FIELD_CLASS}
            >
              {(Object.keys(PAYMENT_MODE_LABELS) as GratificationPaymentMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {PAYMENT_MODE_LABELS[mode]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {value.paymentMode !== "MENSUAL" && (
          <Field
            label={value.paymentMode === "ANUAL" ? "Mes de pago" : "Mes de reliquidación"}
            htmlFor="gratificationMonth"
          >
            <Select
              id="gratificationMonth"
              value={value.settlementMonth}
              onChange={(e) => patch({ settlementMonth: e.target.value })}
              required
              className={FIELD_CLASS}
            >
              <option value="">Seleccione el mes</option>
              {MONTH_LABELS.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {value.paymentMode === "ANTICIPO_MENSUAL_RELIQUIDACION" && (
          <div className="sm:col-span-2">
            <Field label="Anticipo mensual ($)" htmlFor="gratificationMonthlyAdvance">
              <Input
                id="gratificationMonthlyAdvance"
                type="number"
                min={1}
                step={1}
                value={value.monthlyAdvance}
                onChange={(e) => patch({ monthlyAdvance: e.target.value, advanceLinked: false })}
                placeholder="Ej: 300000"
                required
                className={FIELD_CLASS}
              />
            </Field>
            <p className="mt-1 text-xs text-slate-600">
              Monto que se paga cada mes a cuenta de la gratificación; la reliquidación cuadra la diferencia con lo
              que corresponda por ley.{" "}
              {companyAdvancePercentage !== null ? (
                <>
                  {value.advanceLinked ? (
                    <>
                      Calculado con el <strong>{companyAdvancePercentage}%</strong> del sueldo base definido por la
                      empresa.
                    </>
                  ) : (
                    <>
                      La empresa define <strong>{companyAdvancePercentage}%</strong> del sueldo base
                      {suggestedFromCompany !== null && <> ({CLP.format(suggestedFromCompany)})</>}; este monto se
                      ajustó a mano.{" "}
                      <button
                        type="button"
                        className="font-medium text-indigo-700 underline"
                        onClick={() => patch({ advanceLinked: true })}
                      >
                        Volver al % de la empresa
                      </button>
                    </>
                  )}
                </>
              ) : (
                suggestedAdvance !== null && (
                  <>
                    Referencia ({value.percentage}% del sueldo base): <strong>{CLP.format(suggestedAdvance)}</strong>
                    {Number.isFinite(monthlyCapFactor) && monthlyCapFactor > 0 && (
                      <> · tope mensual ≈ {monthlyCapFactor.toFixed(3)} IMM</>
                    )}
                    .{" "}
                    <button
                      type="button"
                      className="font-medium text-indigo-700 underline"
                      onClick={() => patch({ monthlyAdvance: String(suggestedAdvance) })}
                    >
                      Usar referencia
                    </button>
                  </>
                )
              )}
            </p>
          </div>
        )}
        {value.paymentMode === "ANTICIPO_MENSUAL_RELIQUIDACION" && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={value.adjustCpi}
              onChange={(e) => patch({ adjustCpi: e.target.checked })}
            />
            Reajustar anticipos por IPC
          </label>
        )}
      </div>

      {summary && (
        <details className="mt-4 text-sm text-slate-600">
          <summary className="cursor-pointer">Ver estructura de la gratificación que se guardará</summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-slate-100 p-3 text-xs">
            {JSON.stringify(summary, null, 2)}
          </pre>
        </details>
      )}
    </fieldset>
  );
}
