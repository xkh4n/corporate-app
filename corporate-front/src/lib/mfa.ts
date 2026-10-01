import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { apiFetch, ApiError } from "./apiClient";
import type { EnrollResult, MfaFactors, MfaMethod, TotpEnrollStart } from "../types/mfa";
import type { LoginResponse } from "../types/auth";

// Plan 017: cliente de /auth/mfa/*. El login a medio camino viaja en la cookie de sesion (el SPA nunca
// pide mfaToken). "pending" termina un login; "stepUp" re-verifica a alguien ya autenticado antes de
// tocar sus factores.

export type CodeMethod = Exclude<MfaMethod, "webauthn">;

interface Endpoints {
  sendEmail: string;
  webauthnOptions: string;
  verify: string;
}

const PENDING: Endpoints = {
  sendEmail: "/auth/mfa/email/send",
  webauthnOptions: "/auth/mfa/webauthn/options",
  verify: "/auth/mfa/verify",
};

const STEP_UP: Endpoints = {
  sendEmail: "/auth/mfa/step-up/email/send",
  webauthnOptions: "/auth/mfa/step-up/webauthn/options",
  verify: "/auth/mfa/step-up",
};

export type VerifyMode = "pending" | "step-up";

function endpoints(mode: VerifyMode): Endpoints {
  return mode === "pending" ? PENDING : STEP_UP;
}

export async function sendEmailCode(mode: VerifyMode): Promise<string> {
  const { sentTo } = await apiFetch<{ sentTo: string }>(endpoints(mode).sendEmail, { method: "POST", body: {} });
  return sentTo;
}

export async function verifyCode(mode: VerifyMode, method: CodeMethod, code: string): Promise<LoginResponse | undefined> {
  return apiFetch<LoginResponse | undefined>(endpoints(mode).verify, { method: "POST", body: { method, code } });
}

// Pide el challenge, abre el dialogo del navegador (Windows Hello, Touch ID, llave, telefono) y
// manda la firma al backend.
export async function verifyWithPasskey(mode: VerifyMode): Promise<LoginResponse | undefined> {
  const optionsJSON = await apiFetch<PublicKeyCredentialRequestOptionsJSON>(endpoints(mode).webauthnOptions, {
    method: "POST",
    body: {},
  });
  const response = await startAuthentication({ optionsJSON });
  return apiFetch<LoginResponse | undefined>(endpoints(mode).verify, {
    method: "POST",
    body: { method: "webauthn", response },
  });
}

export const mfaApi = {
  factors: () => apiFetch<MfaFactors>("/auth/mfa/factors"),

  totpStart: () => apiFetch<TotpEnrollStart>("/auth/mfa/enroll/totp/start", { method: "POST" }),
  totpConfirm: (code: string) =>
    apiFetch<EnrollResult>("/auth/mfa/enroll/totp/confirm", { method: "POST", body: { code } }),

  emailEnrollSend: () => apiFetch<{ sentTo: string }>("/auth/mfa/enroll/email/send", { method: "POST" }),
  emailEnrollConfirm: (code: string) =>
    apiFetch<EnrollResult>("/auth/mfa/enroll/email/confirm", { method: "POST", body: { code } }),

  async registerPasskey(deviceName: string): Promise<EnrollResult> {
    const optionsJSON = await apiFetch<PublicKeyCredentialCreationOptionsJSON>("/auth/mfa/enroll/webauthn/options", {
      method: "POST",
    });
    const response = await startRegistration({ optionsJSON });
    return apiFetch<EnrollResult>("/auth/mfa/enroll/webauthn/verify", {
      method: "POST",
      body: { response, deviceName },
    });
  },

  removeTotp: () => apiFetch<void>("/auth/mfa/totp", { method: "DELETE" }),
  removeEmail: () => apiFetch<void>("/auth/mfa/email", { method: "DELETE" }),
  removePasskey: (id: number) => apiFetch<void>(`/auth/mfa/webauthn/${id}`, { method: "DELETE" }),
  renamePasskey: (id: number, deviceName: string) =>
    apiFetch<void>(`/auth/mfa/webauthn/${id}`, { method: "PATCH", body: { deviceName } }),
  regenerateRecoveryCodes: () =>
    apiFetch<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { method: "POST" }),
};

export function isStepUpRequired(err: unknown): boolean {
  return err instanceof ApiError && (err.details as { reason?: string } | undefined)?.reason === "mfa_step_up_required";
}

// Mensaje para errores del dialogo de WebAuthn (no vienen del backend).
export function mfaErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) {
    if (err.name === "NotAllowedError") return "Se cancelo o vencio la solicitud de la passkey.";
    if (err.name === "InvalidStateError") return "Esta passkey ya esta registrada en su cuenta.";
    if (err.name === "SecurityError") return "Las passkeys no estan disponibles en esta direccion del sitio.";
  }
  return fallback;
}

export const METHOD_LABELS: Record<MfaMethod, string> = {
  webauthn: "Passkey",
  totp: "App autenticadora",
  email: "Codigo por correo",
  recovery: "Codigo de recuperacion",
};
