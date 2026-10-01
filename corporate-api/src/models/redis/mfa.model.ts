// Plan 017: claves de Redis del segundo factor. Todo con TTL corto: es estado de un login o de un
// enrolamiento en curso, nunca el factor en si (ese vive en MSSQL). "scope" separa los usos de un
// mismo mecanismo: "pending:<id>" (login a medio camino), "enroll:<userId>" y "stepup:<userId>".

export function mfaPendingKey(pendingId: string): string {
  return `mfa-pending:${pendingId}`;
}

export function mfaPendingAttemptsKey(pendingId: string): string {
  return `mfa-pending-attempts:${pendingId}`;
}

export function mfaEmailCodeKey(scope: string): string {
  return `mfa-email-code:${scope}`;
}

export function mfaEmailCooldownKey(scope: string): string {
  return `mfa-email-cooldown:${scope}`;
}

export function mfaTotpUsedKey(userId: number, step: number): string {
  return `mfa-totp-used:${userId}:${step}`;
}

export function mfaTotpEnrollKey(userId: number): string {
  return `mfa-totp-enroll:${userId}`;
}

export function mfaWebauthnChallengeKey(scope: string): string {
  return `mfa-webauthn-challenge:${scope}`;
}

// scope = "sid:<id de sesion>" o "tok:<hash del access token>" (ver library/mfa/stepUpScope.ts).
export function mfaStepUpKey(userId: number, scope: string): string {
  return `mfa-step-up:${userId}:${scope}`;
}

export function mfaUserFailuresKey(userId: number): string {
  return `mfa-user-failures:${userId}`;
}

export function mfaUserDailyFailuresKey(userId: number): string {
  return `mfa-user-failures-day:${userId}`;
}

export function mfaEmailSendsKey(userId: number): string {
  return `mfa-email-sends:${userId}`;
}
