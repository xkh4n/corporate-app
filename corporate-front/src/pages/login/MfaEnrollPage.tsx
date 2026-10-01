import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { EnrollFactor } from "../../components/mfa/EnrollFactor";
import { FactorVerifyForm } from "../../components/mfa/FactorVerifyForm";
import { RecoveryCodesPanel } from "../../components/mfa/RecoveryCodesPanel";
import { Alert, Spinner } from "../../components/ui";
import { mfaApi, mfaErrorMessage } from "../../lib/mfa";
import logo from "../../assets/imperial-logo.png";

// Plan 017: pantalla obligatoria (ver MustChangePasswordGate en AppRoutes.tsx) mientras
// user.mfaEnrollmentRequired sea true: MFA es obligatorio y la cuenta no tiene ningun factor. Al
// confirmar el primero muestra los codigos de recuperacion; recien al seguir se refresca la sesion
// (si se refrescara antes, el gate sacaria al usuario de aca sin que alcance a guardarlos).
export function MfaEnrollPage() {
  const { user, refreshSession, logout } = useAuth();
  const navigate = useNavigate();
  const [webauthnEnabled, setWebauthnEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [finished, setFinished] = useState(false);
  // La verificacion del correo del login vence a los 10 minutos: si vencio, se pide otro codigo.
  const [needsStepUp, setNeedsStepUp] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    mfaApi
      .factors()
      .then((factors) => {
        if (!cancelled) setWebauthnEnabled(factors.webauthnEnabled);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(mfaErrorMessage(err, "No se pudo cargar la configuracion."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (user?.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (user && !user.mfaEnrollmentRequired && !finished) return <Navigate to="/" replace />;

  async function handleContinue() {
    await refreshSession();
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex justify-center">
          <img src={logo} alt="Imperial" className="h-10 w-auto" />
        </div>
        {recoveryCodes ? (
          <>
            <h1 className="mb-4 text-center text-lg font-semibold text-slate-800">Codigos de recuperacion</h1>
            <RecoveryCodesPanel codes={recoveryCodes} onContinue={() => void handleContinue()} continueLabel="Ir al inicio" />
          </>
        ) : (
          <>
            <h1 className="mb-2 text-center text-lg font-semibold text-slate-800">Configure su segundo factor</h1>
            <p className="mb-4 text-center text-sm text-slate-600">
              Ademas de su contraseña, al iniciar sesion se le pedira este segundo paso.
            </p>
            {loadError && <Alert tone="error">{loadError}</Alert>}
            {needsStepUp ? (
              <FactorVerifyForm
                mode="step-up"
                methods={["email"]}
                intro="Por seguridad, confirme de nuevo su correo antes de configurar el segundo factor."
                onVerified={() => {
                  setNeedsStepUp(false);
                  setAttempt((value) => value + 1);
                }}
              />
            ) : webauthnEnabled === null && !loadError ? (
              <div className="flex justify-center">
                <Spinner />
              </div>
            ) : (
              webauthnEnabled !== null && (
                <EnrollFactor
                  key={attempt}
                  webauthnEnabled={webauthnEnabled}
                  onStepUpRequired={() => setNeedsStepUp(true)}
                  onEnrolled={(result) => {
                    setFinished(true);
                    if (result.recoveryCodes) setRecoveryCodes(result.recoveryCodes);
                    else void handleContinue();
                  }}
                />
              )
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-6 w-full text-center text-sm text-slate-500 hover:underline"
            >
              Cerrar sesion
            </button>
          </>
        )}
      </div>
    </div>
  );
}
