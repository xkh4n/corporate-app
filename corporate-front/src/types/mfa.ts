// Plan 017: espejo de corporate-api/src/controllers/mfa.controller.ts y services/mssql/mfa.service.ts.

export type MfaMethod = "webauthn" | "totp" | "email" | "recovery";

// Paso que sigue despues de POST /auth/login o /auth/mfa/verify.
//   EMAIL_VERIFY: primer ingreso, confirmar el correo antes de cambiar la password temporal.
//   MFA: segundo factor de una cuenta ya enrolada.
//   CHANGE_PASSWORD / MFA_ENROLL: sesion iniciada pero bloqueada hasta resolverlo (ver AppRoutes).
export type LoginNextStep = "EMAIL_VERIFY" | "MFA" | "CHANGE_PASSWORD" | "MFA_ENROLL" | null;

export type MfaPendingStage = "EMAIL_VERIFY" | "MFA";

export interface MfaChallenge {
  stage: MfaPendingStage;
  methods: MfaMethod[];
}

export interface WebauthnCredentialSummary {
  id: number;
  deviceName: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface MfaFactors {
  totp: boolean;
  email: boolean;
  webauthn: WebauthnCredentialSummary[];
  recoveryCodesRemaining: number;
  enrolledAt: string | null;
  required: boolean;
  webauthnEnabled: boolean;
  stepUpActive: boolean;
}

export interface EnrollResult {
  // Solo al enrolar el PRIMER factor; despues se regeneran a pedido.
  recoveryCodes: string[] | null;
}

export interface TotpEnrollStart {
  secret: string;
  otpauthUri: string;
}
