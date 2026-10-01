import { useEffect, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { isStepUpRequired, mfaApi, mfaErrorMessage } from "../../lib/mfa";
import type { EnrollResult, TotpEnrollStart } from "../../types/mfa";
import { Alert, Button, Field, Input, Spinner } from "../ui";

export type EnrollMethod = "webauthn" | "totp" | "email";

interface SubProps {
  onDone: (result: EnrollResult) => void;
  // La API pide re-verificar esta sesion antes de agregar un factor (plan 017, revision de seguridad).
  onStepUpRequired: () => void;
}

// Nombre sugerido para la passkey, solo para reconocerla despues en la lista.
function guessDeviceName(): string {
  const agent = navigator.userAgent;
  if (/iPhone|iPad/.test(agent)) return "iPhone / iPad";
  if (/Android/.test(agent)) return "Telefono Android";
  if (/Windows/.test(agent)) return "Windows Hello";
  if (/Macintosh/.test(agent)) return "Mac";
  return "Este equipo";
}

function PasskeyEnroll({ onDone, onStepUpRequired }: SubProps) {
  const [deviceName, setDeviceName] = useState(guessDeviceName);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      onDone(await mfaApi.registerPasskey(deviceName.trim()));
    } catch (err) {
      if (isStepUpRequired(err)) return onStepUpRequired();
      setError(mfaErrorMessage(err, "No se pudo registrar la passkey."));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <p className="text-sm text-slate-600">
        El navegador le pedira confirmar con su huella, rostro, PIN del equipo, su telefono o una llave de seguridad.
      </p>
      <Field label="Nombre para reconocerla" htmlFor="passkey-name">
        <Input
          id="passkey-name"
          required
          maxLength={100}
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
        />
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={loading} className="w-full">
        Registrar passkey
      </Button>
    </form>
  );
}

function TotpEnroll({ onDone, onStepUpRequired }: SubProps) {
  // Ref: el QR se pide una sola vez al montar, aunque el padre pase un callback nuevo en cada render.
  const stepUpRef = useRef(onStepUpRequired);
  useEffect(() => {
    stepUpRef.current = onStepUpRequired;
  });
  const [setup, setSetup] = useState<(TotpEnrollStart & { qr: string }) | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const start = await mfaApi.totpStart();
        // QR generado en el navegador: el secreto no pasa por ningun servicio externo.
        const qr = await QRCode.toDataURL(start.otpauthUri, { margin: 1, width: 220 });
        if (!cancelled) setSetup({ ...start, qr });
      } catch (err) {
        if (cancelled) return;
        if (isStepUpRequired(err)) stepUpRef.current();
        else setError(mfaErrorMessage(err, "No se pudo generar el codigo QR."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      onDone(await mfaApi.totpConfirm(code));
    } catch (err) {
      if (isStepUpRequired(err)) return onStepUpRequired();
      setError(mfaErrorMessage(err, "Codigo incorrecto."));
      setLoading(false);
    }
  }

  if (!setup) {
    return error ? <Alert tone="error">{error}</Alert> : <Spinner />;
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>Abra Google Authenticator, Microsoft Authenticator u otra app compatible.</li>
        <li>Escanee este codigo QR (o ingrese la clave a mano).</li>
        <li>Escriba el codigo de 6 digitos que muestra la app.</li>
      </ol>
      <div className="flex justify-center">
        <img src={setup.qr} alt="Codigo QR para la app autenticadora" className="h-48 w-48 rounded border border-slate-200" />
      </div>
      <p className="break-all text-center font-mono text-xs text-slate-500">
        {setup.secret.match(/.{1,4}/g)?.join(" ")}
      </p>
      <Field label="Codigo de la app" htmlFor="totp-code">
        <Input
          id="totp-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="text-center font-mono tracking-widest"
        />
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={loading} className="w-full">
        Activar
      </Button>
    </form>
  );
}

function EmailEnroll({ onDone, onStepUpRequired }: SubProps) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setError(null);
    setSending(true);
    try {
      setSentTo((await mfaApi.emailEnrollSend()).sentTo);
    } catch (err) {
      if (isStepUpRequired(err)) return onStepUpRequired();
      setError(mfaErrorMessage(err, "No se pudo enviar el codigo."));
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      onDone(await mfaApi.emailEnrollConfirm(code));
    } catch (err) {
      if (isStepUpRequired(err)) return onStepUpRequired();
      setError(mfaErrorMessage(err, "Codigo incorrecto."));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <p className="text-sm text-slate-600">
        {sentTo ? (
          <>
            Enviamos un codigo a <strong>{sentTo}</strong>.
          </>
        ) : (
          "En cada inicio de sesion le enviaremos un codigo a su correo corporativo."
        )}
      </p>
      <Button type="button" variant="secondary" loading={sending} onClick={() => void handleSend()} className="w-full">
        {sentTo ? "Reenviar codigo" : "Enviar codigo de prueba"}
      </Button>
      {sentTo && (
        <>
          <Field label="Codigo recibido" htmlFor="email-code">
            <Input
              id="email-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center font-mono tracking-widest"
            />
          </Field>
          <Button type="submit" loading={loading} className="w-full">
            Activar
          </Button>
        </>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}

const OPTIONS: { method: EnrollMethod; title: string; description: string }[] = [
  {
    method: "webauthn",
    title: "Passkey (recomendada)",
    description: "Huella, rostro o PIN del equipo, su telefono o una llave de seguridad. La mas segura y rapida.",
  },
  {
    method: "totp",
    title: "App autenticadora",
    description: "Google o Microsoft Authenticator generan un codigo que cambia cada 30 segundos.",
  },
  {
    method: "email",
    title: "Codigo por correo",
    description: "Le enviamos un codigo a su correo en cada inicio de sesion.",
  },
];

// Plan 017: alta de un factor. Sin "method" muestra las opciones; con el, va directo a ese flujo.
export function EnrollFactor({
  webauthnEnabled,
  method: fixedMethod,
  exclude = [],
  onEnrolled,
  onStepUpRequired,
}: {
  webauthnEnabled: boolean;
  method?: EnrollMethod;
  exclude?: EnrollMethod[];
  onEnrolled: (result: EnrollResult) => void;
  onStepUpRequired: () => void;
}) {
  const [method, setMethod] = useState<EnrollMethod | null>(fixedMethod ?? null);
  const passkeysUsable = webauthnEnabled && browserSupportsWebAuthn();
  const options = OPTIONS.filter(
    (option) => !exclude.includes(option.method) && (option.method !== "webauthn" || passkeysUsable),
  );

  if (!method) {
    return (
      <div className="space-y-3">
        {options.map((option) => (
          <button
            key={option.method}
            type="button"
            onClick={() => setMethod(option.method)}
            className="w-full rounded-lg border border-slate-200 p-4 text-left hover:border-brand-500 hover:bg-brand-50"
          >
            <span className="block font-medium text-slate-800">{option.title}</span>
            <span className="mt-1 block text-sm text-slate-600">{option.description}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!fixedMethod && (
        <button type="button" onClick={() => setMethod(null)} className="text-sm text-brand-700 hover:underline">
          &larr; Elegir otro metodo
        </button>
      )}
      {method === "webauthn" && <PasskeyEnroll onDone={onEnrolled} onStepUpRequired={onStepUpRequired} />}
      {method === "totp" && <TotpEnroll onDone={onEnrolled} onStepUpRequired={onStepUpRequired} />}
      {method === "email" && <EmailEnroll onDone={onEnrolled} onStepUpRequired={onStepUpRequired} />}
    </div>
  );
}
