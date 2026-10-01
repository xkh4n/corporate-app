import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ChangePasswordForm } from "../../components/account/ChangePasswordForm";
import { EnrollFactor, type EnrollMethod } from "../../components/mfa/EnrollFactor";
import { FactorVerifyForm } from "../../components/mfa/FactorVerifyForm";
import { RecoveryCodesPanel } from "../../components/mfa/RecoveryCodesPanel";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { Alert, Button, Input, Modal, Spinner } from "../../components/ui";
import { isStepUpRequired, mfaApi, mfaErrorMessage } from "../../lib/mfa";
import type { MfaFactors, MfaMethod } from "../../types/mfa";

const PAGE_CLASS = "mx-auto flex w-full max-w-3xl flex-col gap-4 py-4";
const CARD_CLASS = "rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5";

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("es-CL", { dateStyle: "medium" }) : "nunca";
}

// Metodos con los que puede re-verificarse ahora mismo (mismo orden que el backend). Sin factores,
// el codigo al correo de la persona (prueba que controla el buzon antes de enrolar el primero).
function stepUpMethods(factors: MfaFactors): MfaMethod[] {
  if (!hasAnyFactor(factors)) return ["email"];
  const methods: MfaMethod[] = [];
  if (factors.webauthn.length > 0 && factors.webauthnEnabled) methods.push("webauthn");
  if (factors.totp) methods.push("totp");
  if (factors.email) methods.push("email");
  if (factors.recoveryCodesRemaining > 0) methods.push("recovery");
  return methods;
}

// Plan 017: "Seguridad de mi cuenta". Cada usuario administra sus propios factores. Agregar uno
// cuando ya tiene otro, quitarlo o regenerar los codigos exige re-verificar (step-up): si el backend
// lo pide, se abre la verificacion y despues se reintenta la accion.
export function AccountSecurityPage() {
  const { refreshSession } = useAuth();
  const [factors, setFactors] = useState<MfaFactors | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepUpFor, setStepUpFor] = useState<(() => Promise<void>) | null>(null);
  const [enrolling, setEnrolling] = useState<EnrollMethod | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const load = useCallback(async () => {
    try {
      setFactors(await mfaApi.factors());
    } catch (err) {
      setError(mfaErrorMessage(err, "No se pudo cargar la seguridad de la cuenta."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Corre la accion; si el backend pide step-up, la deja pendiente hasta re-verificar.
  async function guarded(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      if (isStepUpRequired(err)) {
        setStepUpFor(() => action);
        return;
      }
      showErrorToast(mfaErrorMessage(err, "No se pudo completar la accion."));
    }
  }

  // Agregar un factor siempre pide re-verificar esta sesion si no lo hizo hace poco.
  function startEnroll(method: EnrollMethod) {
    if (factors && !factors.stepUpActive) {
      setStepUpFor(() => async () => setEnrolling(method));
      return;
    }
    setEnrolling(method);
  }

  function confirmRemove(label: string, remove: () => Promise<void>) {
    if (!window.confirm(`¿Quitar ${label}?`)) return;
    void guarded(async () => {
      await remove();
      showSuccessToast(`${label} quitado.`);
      await load();
      await refreshSession();
    });
  }

  if (error) return <div className={PAGE_CLASS}><Alert tone="error">{error}</Alert></div>;
  if (!factors) return <div className="flex justify-center py-10"><Spinner /></div>;

  const enrolledExcluded: EnrollMethod[] = [
    ...(factors.totp ? (["totp"] as const) : []),
    ...(factors.email ? (["email"] as const) : []),
  ];

  return (
    <div className={PAGE_CLASS}>
      <h1 className="text-center text-xl font-bold text-gray-600 md:text-2xl">Seguridad de mi cuenta</h1>
      {factors.required && (
        <Alert tone="info">El segundo factor es obligatorio: siempre debe quedar al menos uno activo.</Alert>
      )}

      <section className={CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-800">Contraseña</h2>
            <p className="text-sm text-slate-500">Al cambiarla se cierra la sesion en todos sus dispositivos.</p>
          </div>
          <Button type="button" variant="secondary" onClick={() => setChangingPassword(true)}>
            Cambiar contraseña
          </Button>
        </div>
      </section>

      {(factors.webauthnEnabled || factors.webauthn.length > 0) && (
        <section className={CARD_CLASS}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-800">Passkeys</h2>
            {factors.webauthnEnabled && (
              <Button type="button" variant="secondary" onClick={() => startEnroll("webauthn")}>
                Agregar passkey
              </Button>
            )}
          </div>
          {factors.webauthn.length === 0 ? (
            <p className="text-sm text-slate-500">No tiene passkeys registradas.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {factors.webauthn.map((credential) => (
                <li key={credential.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{credential.deviceName}</p>
                    <p className="text-xs text-slate-500">
                      Registrada el {formatDate(credential.createdAt)} · ultimo uso: {formatDate(credential.lastUsedAt)}
                      {credential.backedUp && " · sincronizada"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setRenaming({ id: credential.id, name: credential.deviceName })}
                    >
                      Renombrar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => confirmRemove(`la passkey "${credential.deviceName}"`, () => mfaApi.removePasskey(credential.id))}
                    >
                      Quitar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!factors.webauthnEnabled && (
            <p className="mt-2 text-xs text-slate-500">Las passkeys no estan habilitadas en este ambiente.</p>
          )}
        </section>
      )}

      <section className={CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-800">App autenticadora</h2>
            <p className="text-sm text-slate-500">{factors.totp ? "Activa" : "No configurada"}</p>
          </div>
          {factors.totp ? (
            <Button type="button" variant="ghost" onClick={() => confirmRemove("la app autenticadora", mfaApi.removeTotp)}>
              Quitar
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={() => startEnroll("totp")}>
              Configurar
            </Button>
          )}
        </div>
      </section>

      <section className={CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-800">Codigo por correo</h2>
            <p className="text-sm text-slate-500">{factors.email ? "Activo" : "No configurado"}</p>
          </div>
          {factors.email ? (
            <Button type="button" variant="ghost" onClick={() => confirmRemove("el codigo por correo", mfaApi.removeEmail)}>
              Quitar
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={() => startEnroll("email")}>
              Activar
            </Button>
          )}
        </div>
      </section>

      {hasAnyFactor(factors) && (
        <section className={CARD_CLASS}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-800">Codigos de recuperacion</h2>
              <p className="text-sm text-slate-500">Le quedan {factors.recoveryCodesRemaining} sin usar.</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                void guarded(async () => {
                  setNewCodes((await mfaApi.regenerateRecoveryCodes()).recoveryCodes);
                  await load();
                })
              }
            >
              Generar nuevos
            </Button>
          </div>
        </section>
      )}

      <Modal open={stepUpFor !== null} title="Confirme su identidad" onClose={() => setStepUpFor(null)}>
        {stepUpFor && (
          <FactorVerifyForm
            mode="step-up"
            methods={stepUpMethods(factors)}
            intro="Para cambiar la seguridad de su cuenta, verifique con uno de sus factores actuales."
            onVerified={async () => {
              const action = stepUpFor;
              setStepUpFor(null);
              setFactors({ ...factors, stepUpActive: true });
              await guarded(action);
            }}
          />
        )}
      </Modal>

      <Modal open={enrolling !== null} title="Agregar segundo factor" onClose={() => setEnrolling(null)}>
        {enrolling && (
          <EnrollFactor
            webauthnEnabled={factors.webauthnEnabled}
            method={enrolling}
            exclude={enrolledExcluded}
            onStepUpRequired={() => {
              const method = enrolling;
              setEnrolling(null);
              setStepUpFor(() => async () => setEnrolling(method));
            }}
            onEnrolled={(result) => {
              setEnrolling(null);
              showSuccessToast("Segundo factor agregado.");
              if (result.recoveryCodes) setNewCodes(result.recoveryCodes);
              void load();
              // El escudo de la barra superior sale de /auth/me.
              void refreshSession();
            }}
          />
        )}
      </Modal>

      <Modal open={newCodes !== null} title="Codigos de recuperacion" onClose={() => setNewCodes(null)}>
        {newCodes && <RecoveryCodesPanel codes={newCodes} onContinue={() => setNewCodes(null)} continueLabel="Listo" />}
      </Modal>

      <Modal open={changingPassword} title="Cambiar contraseña" onClose={() => setChangingPassword(false)}>
        {changingPassword && (
          <div className="space-y-4">
            <Alert tone="warning">
              Despues del cambio tendra que iniciar sesion de nuevo con la contraseña nueva y su segundo factor.
            </Alert>
            <ChangePasswordForm autoFocus />
          </div>
        )}
      </Modal>

      <Modal
        open={renaming !== null}
        title="Renombrar passkey"
        onClose={() => setRenaming(null)}
        footer={
          <Button
            type="button"
            disabled={!renaming?.name.trim()}
            onClick={() =>
              void guarded(async () => {
                if (!renaming) return;
                await mfaApi.renamePasskey(renaming.id, renaming.name.trim());
                setRenaming(null);
                await load();
              })
            }
          >
            Guardar
          </Button>
        }
      >
        {renaming && (
          <Input
            aria-label="Nombre de la passkey"
            maxLength={100}
            value={renaming.name}
            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
          />
        )}
      </Modal>
    </div>
  );
}

function hasAnyFactor(factors: MfaFactors): boolean {
  return factors.totp || factors.email || factors.webauthn.length > 0;
}
