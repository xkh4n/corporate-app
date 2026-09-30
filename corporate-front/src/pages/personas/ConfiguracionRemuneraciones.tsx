import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { payrollService } from "../../services";
import type { GratificationType, PayrollParameter } from "../../types";
import { GRATIFICATION_TYPE_LABELS } from "./contract/contractForm";

const REQUIRED_PERMISSIONS = [
  "payroll-settings:read",
  "payroll-settings:update",
  "payroll-parameters:read",
  "payroll-parameters:update",
] as const;

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

// Las fechas llegan como "AAAA-MM-DD": se formatean a mano y no con new Date()
// para que la zona horaria del navegador no las corra un dia.
function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}-${month}-${year}`;
}

export default function ConfiguracionRemuneracionesPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [system, setSystem] = useState<GratificationType | "">("");
  const [advancePercentage, setAdvancePercentage] = useState("");
  const [savingSystem, setSavingSystem] = useState(false);

  const [immHistory, setImmHistory] = useState<PayrollParameter[]>([]);
  const [immValue, setImmValue] = useState("");
  const [immFrom, setImmFrom] = useState("");
  const [savingImm, setSavingImm] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [settings, imm] = await Promise.all([payrollService.getSettings(), payrollService.listParameters("IMM")]);
        if (cancelled) return;
        setSystem(settings?.gratificationSystem ?? "");
        setAdvancePercentage(
          settings?.gratificationMonthlyAdvancePercentage != null
            ? String(settings.gratificationMonthlyAdvancePercentage)
            : "",
        );
        setImmHistory(imm);
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

  async function handleSaveSystem(event: FormEvent) {
    event.preventDefault();
    setSavingSystem(true);
    try {
      // Solo ART50 y CONVENCIONAL anticipan mes a mes; con otro sistema el
      // porcentaje no aplica y se guarda vacio (el backend lo exige asi).
      let percentage: number | null = null;
      if (allowsAdvance && advancePercentage.trim()) {
        percentage = Number(advancePercentage);
        if (!Number.isFinite(percentage) || percentage <= 0 || percentage > maxAdvance) {
          throw createValidationError(`El anticipo mensual debe ser mayor a 0% y hasta ${maxAdvance}% del sueldo base`);
        }
      }
      const saved = await payrollService.saveSettings({
        gratificationSystem: system || null,
        gratificationMonthlyAdvancePercentage: percentage,
      });
      setSystem(saved?.gratificationSystem ?? "");
      setAdvancePercentage(
        saved?.gratificationMonthlyAdvancePercentage != null ? String(saved.gratificationMonthlyAdvancePercentage) : "",
      );
      showSuccessToast("Sistema de gratificación guardado exitosamente");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSavingSystem(false);
    }
  }

  async function handleSaveImm(event: FormEvent) {
    event.preventDefault();
    setSavingImm(true);
    try {
      const value = Number(immValue);
      if (!immValue.trim() || !Number.isFinite(value) || value <= 0) {
        throw createValidationError("El IMM debe ser un monto mayor a cero");
      }
      if (!immFrom) throw createValidationError("Debe indicar desde qué fecha rige el IMM");

      setImmHistory(await payrollService.setParameter({ code: "IMM", value, validFrom: immFrom }));
      setImmValue("");
      setImmFrom("");
      showSuccessToast("IMM registrado exitosamente");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSavingImm(false);
    }
  }

  const currentImm = immHistory.find((item) => item.validTo === null);

  // ART50: el anticipo no puede pasar del 25% legal. ART47 se paga una vez al
  // año (utilidades): no hay anticipo mensual que definir.
  const allowsAdvance = system === "ART50" || system === "CONVENCIONAL";
  const maxAdvance = system === "ART50" ? 25 : 100;
  const advanceValue = Number(advancePercentage);
  const advanceExample =
    allowsAdvance && advancePercentage.trim() && Number.isFinite(advanceValue) && advanceValue > 0
      ? Math.round((1_000_000 * advanceValue) / 100)
      : null;

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center justify-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          Configuración de Remuneraciones
        </h1>

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <div className="w-full max-w-3xl mx-auto sm:px-6 lg:px-8 flex flex-col gap-8">
            <form onSubmit={(event) => void handleSaveSystem(event)} className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-gray-600">Sistema de gratificación de la empresa</h2>
              <Alert tone="info">
                Es el valor con el que se pre-llena el contrato de cada colaborador nuevo. Cada contrato guarda su
                propia gratificación, así que cambiarlo aquí no altera los contratos ya creados.
              </Alert>
              <Field label="Sistema" htmlFor="gratificationSystem">
                <Select
                  id="gratificationSystem"
                  value={system}
                  onChange={(event) => setSystem(event.target.value as GratificationType | "")}
                  className="bg-zinc-100 focus:bg-indigo-100"
                >
                  <option value="">Sin definir</option>
                  {(Object.keys(GRATIFICATION_TYPE_LABELS) as GratificationType[]).map((type) => (
                    <option key={type} value={type}>
                      {GRATIFICATION_TYPE_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </Field>
              {allowsAdvance && (
                <div>
                  <Field label="Anticipo mensual (% del sueldo base)" htmlFor="advancePercentage">
                    <Input
                      id="advancePercentage"
                      type="number"
                      min={0}
                      max={maxAdvance}
                      step={0.01}
                      value={advancePercentage}
                      onChange={(event) => setAdvancePercentage(event.target.value)}
                      placeholder={`Ej: ${maxAdvance === 25 ? "25" : "10"} (opcional)`}
                      className="bg-zinc-100 focus:bg-indigo-100"
                    />
                  </Field>
                  <p className="mt-1 text-xs text-slate-600">
                    Porcentaje del sueldo base que se anticipa cada mes a cuenta de la gratificación
                    {system === "ART50" && " (máximo 25%, el porcentaje legal del Art. 50)"}. Al crear un colaborador
                    el anticipo se calcula en pesos a partir de su sueldo base; se puede ajustar en cada contrato. Cada
                    contrato guarda su monto, así que cambiarlo aquí no altera los ya creados.
                    {advanceExample !== null && (
                      <>
                        {" "}
                        Ejemplo: con un sueldo base de {pesos.format(1_000_000)} el anticipo es{" "}
                        <strong>{pesos.format(advanceExample)}</strong>.
                      </>
                    )}
                  </p>
                </div>
              )}
              <div className="flex justify-center">
                <Button type="submit" loading={savingSystem} className="w-full sm:w-60">
                  Guardar
                </Button>
              </div>
            </form>

            <form onSubmit={(event) => void handleSaveImm(event)} className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-gray-600">Ingreso Mínimo Mensual (IMM)</h2>
              <Alert tone={currentImm ? "info" : "warning"}>
                {currentImm
                  ? `IMM vigente: ${pesos.format(currentImm.value)} desde el ${formatDate(currentImm.validFrom)}.`
                  : "Aún no hay un IMM registrado: el tope de la gratificación (4,75 IMM) no se podrá calcular."}{" "}
                El valor lo informa el usuario; no se precarga.
              </Alert>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Nuevo valor ($)" htmlFor="immValue">
                  <Input
                    id="immValue"
                    type="number"
                    min={1}
                    step={1}
                    value={immValue}
                    onChange={(event) => setImmValue(event.target.value)}
                    className="bg-zinc-100 focus:bg-indigo-100"
                  />
                </Field>
                <Field label="Rige desde" htmlFor="immFrom">
                  <Input
                    id="immFrom"
                    type="date"
                    value={immFrom}
                    onChange={(event) => setImmFrom(event.target.value)}
                    className="bg-zinc-100 focus:bg-indigo-100"
                  />
                </Field>
              </div>
              <div className="flex justify-center">
                <Button type="submit" loading={savingImm} className="w-full sm:w-60">
                  Registrar IMM
                </Button>
              </div>

              {immHistory.length > 0 && (
                <div className="overflow-x-auto">
                <table className="w-full whitespace-nowrap text-sm text-slate-700">
                  <thead>
                    <tr className="border-b border-slate-300 text-left">
                      <th className="py-1">Valor</th>
                      <th className="py-1">Desde</th>
                      <th className="py-1">Hasta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {immHistory.map((item) => (
                      <tr key={item.id} className="border-b border-slate-200">
                        <td className="py-1">{pesos.format(item.value)}</td>
                        <td className="py-1">{formatDate(item.validFrom)}</td>
                        <td className="py-1">{item.validTo ? formatDate(item.validTo) : "Vigente"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}

            </form>
          </div>
        )}
      </div>
    </RequirePermissions>
  );
}
