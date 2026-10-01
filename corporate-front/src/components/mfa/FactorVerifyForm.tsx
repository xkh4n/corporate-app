import { useState, type FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import {
  METHOD_LABELS,
  mfaErrorMessage,
  sendEmailCode,
  verifyCode,
  verifyWithPasskey,
  type CodeMethod,
  type VerifyMode,
} from "../../lib/mfa";
import type { MfaMethod } from "../../types/mfa";
import { Alert, Button, Field, Input } from "../ui";

// Motivos con los que el login a medio camino ya no sirve: hay que volver a poner la password.
const PENDING_GONE = new Set(["mfa_attempts_exceeded", "mfa_pending_expired", "mfa_pending_missing"]);

const CODE_HINTS: Record<CodeMethod, { label: string; placeholder: string; numeric: boolean }> = {
  totp: { label: "Codigo de 6 digitos de su app", placeholder: "123456", numeric: true },
  email: { label: "Codigo recibido por correo", placeholder: "123456", numeric: true },
  recovery: { label: "Codigo de recuperacion", placeholder: "abcde-fghjk", numeric: false },
};

// Plan 017: verifica un factor. "pending" termina un login (LoginPage); "step-up" re-verifica a
// alguien ya autenticado antes de tocar sus factores (Seguridad de mi cuenta).
export function FactorVerifyForm({
  mode,
  methods,
  onVerified,
  onSessionLost,
  intro,
}: {
  mode: VerifyMode;
  methods: MfaMethod[];
  onVerified: () => void | Promise<void>;
  // Solo "pending": el login expiro o se agotaron los intentos.
  onSessionLost?: (message: string) => void;
  intro?: string;
}) {
  const [method, setMethod] = useState<MfaMethod>(methods[0] ?? "totp");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  function selectMethod(next: MfaMethod) {
    setMethod(next);
    setCode("");
    setError(null);
  }

  function handleError(err: unknown, fallback: string) {
    const reason = err instanceof ApiError ? (err.details as { reason?: string } | undefined)?.reason : undefined;
    if (mode === "pending" && reason && PENDING_GONE.has(reason) && onSessionLost) {
      onSessionLost((err as ApiError).message);
      return;
    }
    setError(mfaErrorMessage(err, fallback));
  }

  async function handleSendEmail() {
    setError(null);
    setSending(true);
    try {
      setSentTo(await sendEmailCode(mode));
    } catch (err) {
      handleError(err, "No se pudo enviar el codigo.");
    } finally {
      setSending(false);
    }
  }

  async function handlePasskey() {
    setError(null);
    setLoading(true);
    try {
      await verifyWithPasskey(mode);
      await onVerified();
    } catch (err) {
      handleError(err, "No se pudo verificar la passkey.");
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (method === "webauthn") return;
    setError(null);
    setLoading(true);
    try {
      await verifyCode(mode, method, code);
      await onVerified();
    } catch (err) {
      handleError(err, "Codigo incorrecto.");
      setLoading(false);
    }
  }

  const hint = method === "webauthn" ? null : CODE_HINTS[method];

  return (
    <div className="space-y-4">
      {intro && <p className="text-sm text-slate-600">{intro}</p>}

      {methods.length > 1 && (
        <div role="tablist" aria-label="Metodo de verificacion" className="flex flex-wrap gap-2">
          {methods.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={option === method}
              onClick={() => selectMethod(option)}
              className={`rounded-full border px-3 py-1 text-sm ${
                option === method
                  ? "border-brand-600 bg-brand-50 text-brand-800"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {METHOD_LABELS[option]}
            </button>
          ))}
        </div>
      )}

      {method === "webauthn" ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Use la passkey de este equipo (Windows Hello, Touch ID), de su telefono o una llave de seguridad.
          </p>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="button" loading={loading} onClick={() => void handlePasskey()} className="w-full">
            Usar passkey
          </Button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {method === "email" && (
            <div className="space-y-2">
              {sentTo ? (
                <p className="text-sm text-slate-600">
                  Enviamos un codigo a <strong>{sentTo}</strong>. Vence en 5 minutos.
                </p>
              ) : (
                <p className="text-sm text-slate-600">Le enviaremos un codigo de 6 digitos a su correo.</p>
              )}
              <Button type="button" variant="secondary" loading={sending} onClick={() => void handleSendEmail()} className="w-full">
                {sentTo ? "Reenviar codigo" : "Enviar codigo a mi correo"}
              </Button>
            </div>
          )}
          {hint && (method !== "email" || sentTo) && (
            <Field label={hint.label} htmlFor="mfa-code">
              <Input
                id="mfa-code"
                name="mfa-code"
                autoComplete="one-time-code"
                inputMode={hint.numeric ? "numeric" : "text"}
                maxLength={hint.numeric ? 6 : 16}
                placeholder={hint.placeholder}
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(hint.numeric ? e.target.value.replace(/\D/g, "") : e.target.value)}
                className="text-center font-mono tracking-widest"
              />
            </Field>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          {(method !== "email" || sentTo) && (
            <Button type="submit" loading={loading} className="w-full">
              Verificar
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
