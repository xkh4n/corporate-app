import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../../components/RequirePermissions";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Field } from "../../../components/ui/Field";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { Spinner } from "../../../components/ui/Spinner";
import { showSuccessToast } from "../../../components/Toast";
import { handleError } from "../../../lib/Errors";
import { createValidationError } from "../../../lib/Errors/CustomError";
import { previsionalService } from "../../../services";
import type { PrevisionalInstitution, PreviredEmployerSettings } from "../../../types";
import { ISL_PREVIRED_CODE } from "./constants";

const REQUIRED_PERMISSIONS = [
  "previsional-institutions:read",
  "previred-settings:read",
  "previred-settings:update",
] as const;

export default function CcafMutualEmpresaPage() {
  const navigate = useNavigate();

  const [catalogsLoading, setCatalogsLoading] = useState(true);
  const [ccafs, setCcafs] = useState<PrevisionalInstitution[]>([]);
  const [mutuals, setMutuals] = useState<PrevisionalInstitution[]>([]);

  const [ccafId, setCcafId] = useState("");
  const [mutualId, setMutualId] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [accidentRate, setAccidentRate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function applySettings(settings: PreviredEmployerSettings | null) {
    setCcafId(settings?.ccafInstitutionId ? String(settings.ccafInstitutionId) : "");
    setMutualId(settings?.mutualInstitutionId ? String(settings.mutualInstitutionId) : "");
    setBranchCode(settings?.mutualBranchCode != null ? String(settings.mutualBranchCode) : "");
    setAccidentRate(settings?.workAccidentRate != null ? String(settings.workAccidentRate) : "");
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [ccafRes, mutualRes, settings] = await Promise.all([
          previsionalService.listInstitutions("CCAF", { limit: 100 }),
          previsionalService.listInstitutions("MUTUAL", { limit: 100 }),
          previsionalService.getEmployerSettings(),
        ]);
        if (cancelled) return;
        setCcafs(ccafRes.items);
        setMutuals(mutualRes.items);
        applySettings(settings);
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

  const selectedMutual = mutuals.find((item) => String(item.id) === mutualId);
  // Con ISL (o sin mutualidad) el aporte de accidentes del trabajo va al ISL y
  // no existe sucursal de pago: ese campo lo asigna solo una mutual privada.
  const needsBranch = !!selectedMutual && selectedMutual.previredCode !== ISL_PREVIRED_CODE;

  function validate(): { branch: number | null; rate: number | null } {
    let branch: number | null = null;
    if (needsBranch && branchCode.trim()) {
      branch = Number(branchCode);
      if (!Number.isInteger(branch) || branch < 0 || branch > 999) {
        throw createValidationError("La sucursal de la mutualidad debe ser un número entre 0 y 999");
      }
    }

    let rate: number | null = null;
    if (accidentRate.trim()) {
      rate = Number(accidentRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        throw createValidationError("La tasa de accidentes del trabajo debe estar entre 0 y 100");
      }
    }
    return { branch, rate };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const { branch, rate } = validate();
      const saved = await previsionalService.saveEmployerSettings({
        ccafInstitutionId: ccafId ? Number(ccafId) : null,
        mutualInstitutionId: mutualId ? Number(mutualId) : null,
        mutualBranchCode: branch,
        workAccidentRate: rate,
      });
      applySettings(saved);
      showSuccessToast("Configuración previsional de la empresa guardada exitosamente");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center justify-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          CCAF y Mutualidad de la Empresa
        </h1>

        {catalogsLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <form onSubmit={(event) => void handleSubmit(event)} className="w-full flex flex-col gap-4">
              <Alert tone="info">
                Lo que se defina aquí aplica a todos los colaboradores: no se asigna uno por uno, cada colaborador lo
                hereda al generarse su línea de la nómina Previred.
              </Alert>

              <Field label="Caja de Compensación (CCAF)" htmlFor="ccafId">
                <Select
                  id="ccafId"
                  value={ccafId}
                  onChange={(event) => setCcafId(event.target.value)}
                  className="bg-zinc-100 focus:bg-indigo-100"
                >
                  <option value="">Sin CCAF</option>
                  {ccafs.map((ccaf) => (
                    <option key={ccaf.id} value={ccaf.id}>
                      {ccaf.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Mutualidad" htmlFor="mutualId">
                <Select
                  id="mutualId"
                  value={mutualId}
                  onChange={(event) => setMutualId(event.target.value)}
                  className="bg-zinc-100 focus:bg-indigo-100"
                >
                  <option value="">Sin definir</option>
                  {mutuals.map((mutual) => (
                    <option key={mutual.id} value={mutual.id}>
                      {mutual.previredCode === ISL_PREVIRED_CODE ? `${mutual.name} (sin mutual privada)` : mutual.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {needsBranch && (
                  <Field label="Sucursal para pago (código de la mutual)" htmlFor="branchCode">
                    <Input
                      id="branchCode"
                      type="number"
                      min={0}
                      max={999}
                      step={1}
                      value={branchCode}
                      onChange={(event) => setBranchCode(event.target.value)}
                      className="bg-zinc-100 focus:bg-indigo-100"
                    />
                  </Field>
                )}

                <Field label="Tasa de accidentes del trabajo (%)" htmlFor="accidentRate">
                  <Input
                    id="accidentRate"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={accidentRate}
                    onChange={(event) => setAccidentRate(event.target.value)}
                    placeholder="Base + adicional + Ley SANNA"
                    className="bg-zinc-100 focus:bg-indigo-100"
                  />
                </Field>
              </div>

              <div className="flex justify-center mt-2">
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
