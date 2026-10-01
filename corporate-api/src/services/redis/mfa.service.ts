import { randomBytes, timingSafeEqual } from "node:crypto";
import { redis } from "../../databases/redis/connection";
import {
  mfaEmailCodeKey,
  mfaEmailCooldownKey,
  mfaEmailSendsKey,
  mfaUserDailyFailuresKey,
  mfaUserFailuresKey,
  mfaPendingAttemptsKey,
  mfaPendingKey,
  mfaStepUpKey,
  mfaTotpEnrollKey,
  mfaTotpUsedKey,
  mfaWebauthnChallengeKey,
} from "../../models/redis/mfa.model";
import { hashCode } from "../../library/mfa/keys";
import { TOTP_PERIOD_SECONDS } from "../../library/mfa/totp";

// Login a medio camino: la password ya se valido pero falta el segundo factor (o, en el primer
// ingreso, verificar el correo). Vive aca y NO en req.session.user: mientras exista solo esto, el
// usuario no esta autenticado para ninguna otra ruta (ni REST ni Socket.IO).
export type MfaStage = "EMAIL_VERIFY" | "MFA";

export interface MfaPending {
  userId: number;
  stage: MfaStage;
  issueTokens: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

export const MFA_PENDING_TTL_SECONDS = 10 * 60;
export const MFA_MAX_ATTEMPTS = 5;
const EMAIL_CODE_TTL_SECONDS = 5 * 60;
const EMAIL_RESEND_COOLDOWN_SECONDS = 60;
const TOTP_ENROLL_TTL_SECONDS = 10 * 60;
const WEBAUTHN_CHALLENGE_TTL_SECONDS = 5 * 60;
// 10 min: alcanza para escanear el QR o registrar la passkey despues de verificar el correo.
export const STEP_UP_TTL_SECONDS = 10 * 60;

export async function createPending(data: Omit<MfaPending, "createdAt">): Promise<string> {
  const pendingId = randomBytes(32).toString("base64url");
  const value: MfaPending = { ...data, createdAt: new Date().toISOString() };
  await redis.set(mfaPendingKey(pendingId), JSON.stringify(value), { EX: MFA_PENDING_TTL_SECONDS });
  return pendingId;
}

export async function getPending(pendingId: string): Promise<MfaPending | null> {
  const raw = await redis.get(mfaPendingKey(pendingId));
  return raw ? (JSON.parse(raw) as MfaPending) : null;
}

export async function deletePending(pendingId: string): Promise<void> {
  await redis.del([
    mfaPendingKey(pendingId),
    mfaPendingAttemptsKey(pendingId),
    mfaEmailCodeKey(`pending:${pendingId}`),
    mfaEmailCooldownKey(`pending:${pendingId}`),
    mfaWebauthnChallengeKey(`pending:${pendingId}`),
  ]);
}

// Reserva un intento ANTES de verificar (revision de seguridad 2026-10-01, H1): contar despues dejaba
// que requests en paralelo evaluaran mas de 5 codigos con el mismo login a medio camino. Pasado el
// tope el login se descarta entero y hay que volver a poner la password.
export async function reservePendingAttempt(pendingId: string): Promise<{ allowed: boolean }> {
  const key = mfaPendingAttemptsKey(pendingId);
  const [attempts] = (await redis.multi().incr(key).expire(key, MFA_PENDING_TTL_SECONDS).exec()) as unknown as [number];
  if (attempts > MFA_MAX_ATTEMPTS) {
    await deletePending(pendingId);
    return { allowed: false };
  }
  return { allowed: true };
}

// ---- Tope de fallos por USUARIO ----------------------------------------------------------------
// El tope por login a medio camino solo no alcanzaba (revision de seguridad 2026-10-01, H1): quien
// conoce la password abria logins nuevos sin limite, cada uno con 5 intentos frescos. Este contador
// es de la cuenta y lo comparten el login, el step-up y la confirmacion de enrolamientos.
// Dos ventanas: 10 fallos en 15 min frena la rafaga; 30 en 24 h acota el goteo lento (la ventana
// corta sola dejaba ~960 intentos por dia; revision de seguridad 2026-10-01, N3).
export const MFA_USER_MAX_FAILURES = 10;
const MFA_USER_LOCK_SECONDS = 15 * 60;
export const MFA_USER_MAX_DAILY_FAILURES = 30;
const MFA_USER_DAILY_SECONDS = 24 * 60 * 60;

const WINDOWS = [
  { key: mfaUserFailuresKey, max: MFA_USER_MAX_FAILURES, seconds: MFA_USER_LOCK_SECONDS },
  { key: mfaUserDailyFailuresKey, max: MFA_USER_MAX_DAILY_FAILURES, seconds: MFA_USER_DAILY_SECONDS },
];

export type ReserveResult = { allowed: true } | { allowed: false; justLocked: boolean };

// Reserva un intento para la cuenta en las dos ventanas. justLocked = este intento es el que la
// bloqueo (para avisar al dueño una sola vez por bloqueo).
export async function reserveUserAttempt(userId: number): Promise<ReserveResult> {
  const transaction = redis.multi();
  // SET NX EX + INCR en la misma transaccion: las claves nunca quedan sin TTL.
  for (const window of WINDOWS) {
    transaction.set(window.key(userId), "0", { NX: true, EX: window.seconds }).incr(window.key(userId));
  }
  const replies = (await transaction.exec()) as unknown as unknown[];
  const counts = WINDOWS.map((_, index) => Number(replies[index * 2 + 1]));
  const over = WINDOWS.map((window, index) => counts[index]! - window.max);
  if (over.every((excess) => excess <= 0)) return { allowed: true };
  return { allowed: false, justLocked: over.some((excess) => excess === 1) };
}

// Un acierto devuelve el intento reservado: solo los fallos se acumulan. Sin DEL (revision de
// seguridad 2026-10-01, N5): borrar podia llevarse un fallo reservado en paralelo; si la clave ya
// habia vencido, el DECR la deja en -1 y se borra solo ese caso.
export async function releaseUserAttempt(userId: number): Promise<void> {
  for (const window of WINDOWS) {
    const key = window.key(userId);
    if ((await redis.decr(key)) < 0) await redis.del(key);
  }
}

export async function isUserLocked(userId: number): Promise<boolean> {
  const values = await redis.mGet(WINDOWS.map((window) => window.key(userId)));
  return values.some((raw, index) => raw !== null && Number(raw) >= WINDOWS[index]!.max);
}

// ---- Codigo por correo -------------------------------------------------------------------------

// false = todavia corre la espera entre envios (no se genera un codigo nuevo).
export async function storeEmailCode(scope: string, code: string): Promise<boolean> {
  const cooldown = await redis.set(mfaEmailCooldownKey(scope), "1", { NX: true, EX: EMAIL_RESEND_COOLDOWN_SECONDS });
  if (cooldown !== "OK") return false;
  const key = mfaEmailCodeKey(scope);
  await redis
    .multi()
    .del(key)
    .hSet(key, { hash: hashCode(code), attempts: "0" })
    .expire(key, EMAIL_CODE_TTL_SECONDS)
    .exec();
  return true;
}

// Tope por USUARIO, no por login a medio camino: quien conoce la password puede abrir logins nuevos
// y, sin esto, mandarle correos sin limite al buzon de la victima. Solo cuentan los envios reales:
// los pedidos frenados por la espera de 60 s no gastan cupo (revision de seguridad 2026-10-01).
const EMAIL_SENDS_PER_HOUR = 10;

export async function canSendEmail(userId: number): Promise<boolean> {
  const raw = await redis.get(mfaEmailSendsKey(userId));
  return raw === null || Number(raw) < EMAIL_SENDS_PER_HOUR;
}

export async function countEmailSend(userId: number): Promise<void> {
  const key = mfaEmailSendsKey(userId);
  await redis.multi().set(key, "0", { NX: true, EX: 60 * 60 }).incr(key).exec();
}

// Un solo uso y tope de intentos por codigo. El DEL final decide entre dos requests simultaneas con
// el mismo codigo: solo una lo borra y gana.
export async function consumeEmailCode(scope: string, code: string): Promise<boolean> {
  const key = mfaEmailCodeKey(scope);
  // Lectura e incremento juntos: si otra request borro el codigo entre medio, el HINCRBY recrearia
  // la clave sin TTL; en ese caso se borra y listo.
  const [stored, attempts] = (await redis
    .multi()
    .hGet(key, "hash")
    .hIncrBy(key, "attempts", 1)
    .exec()) as unknown as [string | null, number];
  if (!stored) {
    await redis.del(key);
    return false;
  }
  if (attempts > MFA_MAX_ATTEMPTS) {
    await redis.del(key);
    return false;
  }
  const given = Buffer.from(hashCode(code));
  const expected = Buffer.from(stored);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  return (await redis.del(key)) === 1;
}

// Sin la espera entre envios: el primer envio de un enrolamiento o step-up no debe esperar a uno
// anterior de otro flujo.
export async function clearEmailCode(scope: string): Promise<void> {
  await redis.del([mfaEmailCodeKey(scope), mfaEmailCooldownKey(scope)]);
}

// ---- TOTP --------------------------------------------------------------------------------------

// Anti-replay: cada paso de 30 s sirve una sola vez por usuario (un codigo visto por encima del
// hombro o interceptado no se puede reusar dentro de su ventana). SET NX es atomico entre replicas.
export async function markTotpStepUsed(userId: number, step: number): Promise<boolean> {
  const result = await redis.set(mfaTotpUsedKey(userId, step), "1", { NX: true, EX: TOTP_PERIOD_SECONDS * 4 });
  return result === "OK";
}

// Secreto propuesto mientras el usuario lo escanea; recien pasa a MSSQL cuando confirma un codigo.
// Se guarda ya cifrado.
export async function storeTotpEnrollSecret(userId: number, encryptedSecret: string): Promise<void> {
  await redis.set(mfaTotpEnrollKey(userId), encryptedSecret, { EX: TOTP_ENROLL_TTL_SECONDS });
}

export async function getTotpEnrollSecret(userId: number): Promise<string | null> {
  return redis.get(mfaTotpEnrollKey(userId));
}

export async function deleteTotpEnrollSecret(userId: number): Promise<void> {
  await redis.del(mfaTotpEnrollKey(userId));
}

// ---- WebAuthn ----------------------------------------------------------------------------------

export async function storeWebauthnChallenge(scope: string, challenge: string): Promise<void> {
  await redis.set(mfaWebauthnChallengeKey(scope), challenge, { EX: WEBAUTHN_CHALLENGE_TTL_SECONDS });
}

// GETDEL: el challenge se consume aunque la verificacion falle, asi no se puede reintentar con el
// mismo.
export async function takeWebauthnChallenge(scope: string): Promise<string | null> {
  return redis.getDel(mfaWebauthnChallengeKey(scope));
}

// ---- Re-verificacion reciente (step-up) --------------------------------------------------------

// Borrar un factor, agregar otro o regenerar los codigos de recuperacion exige haber probado un
// factor hace poco: una sesion robada no alcanza para dejar al atacante con su propio factor. Atado
// a la SESION (o al access token), no a la cuenta (revision de seguridad 2026-10-01): antes, el login
// legitimo de la victima habilitaba por 5 minutos a cualquier otra sesion de la misma cuenta.
// Muere solo con la sesion: un reset o cambio de password invalida la sesion y con ella esto.
export async function markStepUp(userId: number, scope: string): Promise<void> {
  await redis.set(mfaStepUpKey(userId, scope), String(Date.now()), { EX: STEP_UP_TTL_SECONDS });
}

export async function hasRecentStepUp(userId: number, scope: string): Promise<boolean> {
  return (await redis.exists(mfaStepUpKey(userId, scope))) === 1;
}
