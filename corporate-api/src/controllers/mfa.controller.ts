import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { env } from "../library/env";
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "../library/errors";
import { sendNoContent, sendOk } from "../library/response";
import { logger } from "../library/logger";
import { completeLogin, issueTokenPair } from "../library/authSession";
import { stepUpScope, tokenScope } from "../library/mfa/stepUpScope";
import { revokeAllRefreshTokens } from "../services/redis/session.service";
import { getMfaKey } from "../library/mfa/keys";
import { decryptSecret, encryptSecret } from "../library/mfa/secretBox";
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from "../library/mfa/totp";
import { generateEmailCode, maskEmail, sendMfaCodeEmail, sendMfaLockedEmail, type EmailCodePurpose } from "../library/mfa/mail";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  checkAuthentication,
  checkRegistration,
  isWebauthnEnabled,
} from "../library/mfa/webauthn";
import { PASSWORD_CHANGE_REQUIRED } from "../middlewares/authenticate";
import { getUserByIdOrThrow } from "../services/mssql/user.service";
import { getPersonByIdOrThrow } from "../services/mssql/person.service";
import { getRoleByIdOrThrow } from "../services/postgres/role.service";
import * as mfaStore from "../services/mssql/mfa.service";
import * as mfaState from "../services/redis/mfa.service";
import type { UserModel } from "../models/mssql/user.model";
import type { AuthenticatedUser } from "../types/auth.types";

// Plan 017: segundo factor. Tres grupos de rutas (ver routes/auth.routes.ts):
//   - login a medio camino (sin req.user): enviar codigo, opciones de passkey, verificar;
//   - enrolamiento (authenticateAllowingPending): primer factor o uno adicional;
//   - administracion de los propios factores y step-up (authenticate).

// ---- Esquemas ----------------------------------------------------------------------------------

// La forma exacta la valida @simplewebauthn/server; aca solo lo minimo para no pasarle cualquier cosa.
const webauthnResponseSchema = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.looseObject({}),
  clientExtensionResults: z.looseObject({}).optional().default({}),
});

const mfaToken = z.string().min(1).max(200).optional();

export const verifySchema = z.discriminatedUnion("method", [
  z.object({ method: z.enum(["totp", "email", "recovery"]), code: z.string().min(1).max(32), mfaToken }),
  z.object({ method: z.literal("webauthn"), response: webauthnResponseSchema, mfaToken }),
]);

export const stepUpSchema = z.discriminatedUnion("method", [
  z.object({ method: z.enum(["totp", "email", "recovery"]), code: z.string().min(1).max(32) }),
  z.object({ method: z.literal("webauthn"), response: webauthnResponseSchema }),
]);

export const pendingSchema = z.object({ mfaToken }).optional().default({});

export const codeSchema = z.object({ code: z.string().min(1).max(32) });

export const webauthnRegisterSchema = z.object({
  response: webauthnResponseSchema,
  deviceName: z.string().trim().min(1).max(100),
});

export const renameCredentialSchema = z.object({ deviceName: z.string().trim().min(1).max(100) });

type FactorInput = z.infer<typeof stepUpSchema>;

// ---- Verificacion comun ------------------------------------------------------------------------

// Reserva un intento de la cuenta o responde 429. Al bloquearse, avisa una vez al dueño: llegar
// hasta aca exige la password, asi que es señal de que esta comprometida (revision de seguridad
// 2026-10-01, N3). El aviso es best-effort y no frena la respuesta.
async function reserveOrLock(user: UserModel): Promise<void> {
  const result = await mfaState.reserveUserAttempt(user.id);
  if (result.allowed) return;
  if (result.justLocked) {
    logger.warn({ event: "mfa_locked", userId: user.id }, "MFA: cuenta bloqueada por intentos fallidos");
    void getPersonByIdOrThrow(user.personId)
      .then((person) => sendMfaLockedEmail(person.email))
      .catch((err: unknown) => logger.error({ err, userId: user.id }, "MFA: no se pudo avisar el bloqueo"));
  }
  throw new AppError(429, "Demasiados intentos fallidos de segundo factor. Intente mas tarde.", { reason: "mfa_locked" });
}

// Ata el secreto TOTP cifrado a su cuenta (ver library/mfa/secretBox.ts). El formato viejo sin AAD
// solo se acepta en development, donde existio antes de este cambio.
function totpAad(userId: number): string {
  return `user:${userId}`;
}
const LEGACY = { allowV1: env.nodeEnv === "development" };

// Todo intento de verificar un factor pasa por el tope de fallos de la CUENTA (revision de
// seguridad 2026-10-01, H1): reservar antes de verificar cierra la carrera de requests en paralelo,
// y un acierto devuelve el intento. Pasado el tope, 429 durante 15 minutos.
async function attemptFactor(user: UserModel, scope: string, input: FactorInput): Promise<boolean> {
  await reserveOrLock(user);
  const ok = await verifyFactor(user, scope, input);
  if (ok) await mfaState.releaseUserAttempt(user.id);
  else logger.info({ event: "mfa_verify_failed", userId: user.id, method: input.method }, "MFA: verificacion fallida");
  return ok;
}

// scope separa los codigos/challenges de cada flujo: uno emitido para el login no sirve para un
// step-up ni para enrolar (ver models/redis/mfa.model.ts).
async function verifyFactor(user: UserModel, scope: string, input: FactorInput): Promise<boolean> {
  switch (input.method) {
    case "totp": {
      if (!user.mfaTotpSecretEnc) return false;
      const secret = decryptSecret(user.mfaTotpSecretEnc, getMfaKey("totp-secret"), totpAad(user.id), LEGACY);
      const step = verifyTotp(secret, input.code.trim());
      return step !== null && (await mfaState.markTotpStepUsed(user.id, step));
    }
    case "email":
      return mfaState.consumeEmailCode(scope, input.code.trim());
    case "recovery":
      return mfaStore.consumeRecoveryCode(user.id, input.code);
    case "webauthn": {
      if (!isWebauthnEnabled()) return false;
      const challenge = await mfaState.takeWebauthnChallenge(scope);
      if (!challenge) return false;
      const credential = await mfaStore.findCredentialForUser(user.id, input.response.id);
      if (!credential) return false;
      try {
        const result = await checkAuthentication(
          input.response as unknown as AuthenticationResponseJSON,
          challenge,
          credential,
        );
        if (!result) return false;
        await mfaStore.recordCredentialUse(credential.credentialId, result.newSignCount, result.backedUp);
        return true;
      } catch (err) {
        // Incluye un contador que no avanza (posible passkey clonada): vale la pena dejar rastro.
        logger.warn({ err: (err as Error).message, userId: user.id }, "MFA: passkey rechazada");
        return false;
      }
    }
  }
}

async function sendEmailCode(user: UserModel, scope: string, purpose: EmailCodePurpose): Promise<string> {
  if (!(await mfaState.canSendEmail(user.id))) {
    throw new AppError(429, "Se enviaron demasiados codigos. Espere una hora o use otro metodo.");
  }
  const code = generateEmailCode();
  if (!(await mfaState.storeEmailCode(scope, code))) {
    throw new AppError(429, "Espere un minuto antes de pedir otro codigo.");
  }
  const person = await getPersonByIdOrThrow(user.personId);
  if (!(await sendMfaCodeEmail(person.email, code, purpose))) {
    // Sin correo enviado el codigo no sirve: se libera la espera para poder reintentar enseguida.
    await mfaState.clearEmailCode(scope);
    throw new AppError(503, "No se pudo enviar el codigo por correo. Intente nuevamente en unos minutos.");
  }
  await mfaState.countEmailSend(user.id);
  return maskEmail(person.email);
}

// ---- Login a medio camino ----------------------------------------------------------------------

interface ResolvedPending {
  pendingId: string;
  pending: mfaState.MfaPending;
  user: UserModel;
}

async function resolvePending(req: Request): Promise<ResolvedPending> {
  const body = req.body as { mfaToken?: string } | undefined;
  const pendingId = req.session?.mfaPendingId ?? body?.mfaToken;
  if (!pendingId) throw new UnauthorizedError("No hay un inicio de sesion pendiente", { reason: "mfa_pending_missing" });
  const pending = await mfaState.getPending(pendingId);
  if (!pending) {
    if (req.session) delete req.session.mfaPendingId;
    throw new UnauthorizedError("El inicio de sesion expiro. Ingrese nuevamente.", { reason: "mfa_pending_expired" });
  }
  const user = await getUserByIdOrThrow(pending.userId);
  // Desactivada entre la password y el segundo factor: mismo 401 generico que el login.
  if (!user.isActive) {
    await mfaState.deletePending(pendingId);
    throw new UnauthorizedError("Credenciales invalidas");
  }
  return { pendingId, pending, user };
}

async function assertMethodAllowed(resolved: ResolvedPending, method: mfaStore.MfaMethod): Promise<void> {
  if (resolved.pending.stage === "EMAIL_VERIFY") {
    if (method !== "email") throw new BadRequestError("Primero confirme su correo con el codigo que le enviamos");
    return;
  }
  const methods = mfaStore.availableMethods(await mfaStore.getMfaFactors(resolved.user));
  if (!methods.includes(method)) throw new BadRequestError("Ese metodo no esta disponible para su cuenta");
}

// POST /auth/mfa/email/send
export async function pendingEmailSend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const resolved = await resolvePending(req);
    await assertMethodAllowed(resolved, "email");
    const purpose = resolved.pending.stage === "EMAIL_VERIFY" ? "verify-email" : "login";
    const sentTo = await sendEmailCode(resolved.user, `pending:${resolved.pendingId}`, purpose);
    sendOk(res, { sentTo }, "Codigo enviado");
  } catch (err) {
    next(err);
  }
}

// POST /auth/mfa/webauthn/options
export async function pendingWebauthnOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const resolved = await resolvePending(req);
    await assertMethodAllowed(resolved, "webauthn");
    const options = await buildAuthenticationOptions(await mfaStore.listStoredCredentials(resolved.user.id));
    await mfaState.storeWebauthnChallenge(`pending:${resolved.pendingId}`, options.challenge);
    sendOk(res, options, "Opciones de passkey generadas");
  } catch (err) {
    next(err);
  }
}

// POST /auth/mfa/verify: termina el login (o el primer paso del primer ingreso).
export async function pendingVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = req.body as z.infer<typeof verifySchema>;
    const resolved = await resolvePending(req);
    await assertMethodAllowed(resolved, input.method);

    // Tope del login a medio camino (5) reservado antes de verificar; ademas attemptFactor aplica
    // el tope de la cuenta, que no se reinicia abriendo logins nuevos.
    if (!(await mfaState.reservePendingAttempt(resolved.pendingId)).allowed) {
      if (req.session) delete req.session.mfaPendingId;
      throw new UnauthorizedError("Demasiados intentos fallidos. Ingrese nuevamente.", { reason: "mfa_attempts_exceeded" });
    }
    if (!(await attemptFactor(resolved.user, `pending:${resolved.pendingId}`, input))) {
      throw new UnauthorizedError("Codigo incorrecto o vencido", { reason: "mfa_invalid_code" });
    }

    await mfaState.deletePending(resolved.pendingId);

    // El rol puede haberse desactivado mientras tanto: mismo criterio que el login.
    const role = await getRoleByIdOrThrow(resolved.user.roleId);
    if (!role.isActive) throw new UnauthorizedError("Credenciales invalidas");
    const authUser: AuthenticatedUser = {
      userId: resolved.user.id,
      personId: resolved.user.personId,
      username: resolved.user.username,
      roleId: role.id,
      roleName: role.name,
    };
    const factors = await mfaStore.getMfaFactors(resolved.user);
    const mfaEnrollmentRequired = env.mfa.required && mfaStore.countFactors(factors) === 0;
    const tokens = await completeLogin(req, authUser, {
      mustChangePassword: resolved.pending.mustChangePassword,
      mfaEnrollmentRequired,
      issueTokens: resolved.pending.issueTokens,
    });
    // Recien probo un factor (o su correo, si va a enrolar el primero): vale como re-verificacion
    // reciente, pero SOLO para esta sesion nueva (o este access token).
    const scope = tokens ? tokenScope(tokens.accessToken) : stepUpScope(req);
    await mfaState.markStepUp(resolved.user.id, scope);
    logger.info({ event: "mfa_login", userId: resolved.user.id, method: input.method, stage: resolved.pending.stage }, "MFA: login completado");

    let nextStep: string | null = null;
    if (resolved.pending.mustChangePassword) nextStep = "CHANGE_PASSWORD";
    else if (mfaEnrollmentRequired) nextStep = "MFA_ENROLL";
    sendOk(res, { user: authUser, next: nextStep, ...tokens }, "Login exitoso");
  } catch (err) {
    next(err);
  }
}

// ---- Factores del usuario autenticado ----------------------------------------------------------

// GET /auth/mfa/factors
export async function listFactors(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { factors } = await mfaStore.getUserFactors(req.user!.userId);
    sendOk(
      res,
      {
        ...factors,
        required: env.mfa.required,
        webauthnEnabled: isWebauthnEnabled(),
        // De ESTA sesion: otra sesion de la misma cuenta no ve ni aprovecha el step-up ajeno.
        stepUpActive: await mfaState.hasRecentStepUp(req.user!.userId, stepUpScope(req)),
      },
      "Factores obtenidos exitosamente",
    );
  } catch (err) {
    next(err);
  }
}

// Agregar un factor SIEMPRE exige step-up de esta sesion (revision de seguridad 2026-10-01, M1):
// la password sola no alcanza para enrolar, ni siquiera el primero, porque quien la robo dejaria
// afuera al dueño. Sin factores, el step-up es el codigo al correo de la persona (el login de una
// cuenta sin factores ya lo pide cuando MFA es obligatorio). Con la password todavia por cambiar no
// se enrola: primero el cambio (que invalida la sesion), despues el factor.
async function assertCanEnroll(req: Request): Promise<{ user: UserModel; factors: mfaStore.MfaFactors }> {
  if (req.passwordChangePending) {
    throw new ForbiddenError("Debe cambiar su contraseña antes de continuar", { reason: PASSWORD_CHANGE_REQUIRED });
  }
  const { user, factors } = await mfaStore.getUserFactors(req.user!.userId);
  if (!(await mfaState.hasRecentStepUp(user.id, stepUpScope(req)))) {
    throw new ForbiddenError("Confirme su identidad antes de agregar un segundo factor", { reason: "mfa_step_up_required" });
  }
  return { user, factors };
}

// Metodos validos para un step-up: los factores activos, o el correo de la persona si todavia no
// tiene ninguno (prueba que controla el buzon antes de enrolar el primero). Las rutas de step-up
// aceptan sesiones con el enrolamiento pendiente (revision de seguridad 2026-10-01, N1: si vencia la
// verificacion del login no habia como renovarla), pero solo con el correo y nunca con la password
// todavia por cambiar.
function stepUpMethods(req: Request, factors: mfaStore.MfaFactors): mfaStore.MfaMethod[] {
  if (req.passwordChangePending) {
    throw new ForbiddenError("Debe cambiar su contraseña antes de continuar", { reason: PASSWORD_CHANGE_REQUIRED });
  }
  if (req.mfaEnrollmentPending || mfaStore.countFactors(factors) === 0) return ["email"];
  return mfaStore.availableMethods(factors);
}

// Cierre comun de un alta: si era el primer factor, la marca de enrolamiento pendiente se limpia en
// la misma sesion (acaba de probar el factor) o, para clientes solo-token, con un par nuevo. Los
// codigos de recuperacion se devuelven una unica vez.
//
// Con el PRIMER factor se revocan ademas todos los refresh tokens de la cuenta: uno emitido antes
// (por ejemplo, a quien tenia la password) ya no renueva sin pasar por el segundo factor.
async function finishEnrollment(
  req: Request,
  res: Response,
  method: mfaStore.MfaMethod,
  recoveryCodes: string[] | null,
): Promise<void> {
  const user = req.user!;
  logger.info({ event: "mfa_factor_added", userId: user.userId, method, first: recoveryCodes !== null }, "MFA: factor agregado");
  if (recoveryCodes) await revokeAllRefreshTokens(user.userId);
  let tokens: Awaited<ReturnType<typeof issueTokenPair>> | undefined;
  if (req.session?.user) {
    delete req.session.user.mfaEnrollmentRequired;
  } else if (req.mfaEnrollmentPending || recoveryCodes) {
    tokens = await issueTokenPair(user, { mustChangePassword: false, mfaEnrollmentRequired: false });
  }
  await mfaState.markStepUp(user.userId, tokens ? tokenScope(tokens.accessToken) : stepUpScope(req));
  sendOk(res, { recoveryCodes, ...tokens }, "Segundo factor configurado");
}

// POST /auth/mfa/enroll/totp/start
export async function enrollTotpStart(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { user, factors } = await assertCanEnroll(req);
    if (factors.totp) throw new ConflictError("Ya tiene una app autenticadora configurada");
    const secret = generateTotpSecret();
    await mfaState.storeTotpEnrollSecret(user.id, encryptSecret(secret, getMfaKey("totp-secret"), totpAad(user.id)));
    const otpauthUri = buildOtpauthUri({ secret, accountName: user.username, issuer: env.mfa.issuer });
    sendOk(res, { secret, otpauthUri }, "Escanee el codigo QR con su app autenticadora");
  } catch (err) {
    next(err);
  }
}

// POST /auth/mfa/enroll/totp/confirm
export async function enrollTotpConfirm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.body as z.infer<typeof codeSchema>;
    const { user } = await assertCanEnroll(req);
    const encrypted = await mfaState.getTotpEnrollSecret(user.id);
    if (!encrypted) throw new BadRequestError("El enrolamiento expiro. Vuelva a generar el codigo QR.");
    const secret = decryptSecret(encrypted, getMfaKey("totp-secret"), totpAad(user.id), LEGACY);
    await reserveOrLock(user);
    const step = verifyTotp(secret, code.trim());
    if (step === null || !(await mfaState.markTotpStepUsed(user.id, step))) {
      throw new BadRequestError("Codigo incorrecto. Revise que la hora del telefono este correcta.");
    }
    await mfaState.releaseUserAttempt(user.id);
    const recoveryCodes = await mfaStore.enableTotp(user.id, encrypted);
    await mfaState.deleteTotpEnrollSecret(user.id);
    await finishEnrollment(req, res, "totp", recoveryCodes);
  } catch (err) {
    next(err);
  }
}

// POST /auth/mfa/enroll/email/send
export async function enrollEmailSend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { user, factors } = await assertCanEnroll(req);
    if (factors.email) throw new ConflictError("El codigo por correo ya esta activo");
    const sentTo = await sendEmailCode(user, `enroll:${stepUpScope(req)}`, "enroll");
    sendOk(res, { sentTo }, "Codigo enviado");
  } catch (err) {
    next(err);
  }
}

// POST /auth/mfa/enroll/email/confirm
export async function enrollEmailConfirm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.body as z.infer<typeof codeSchema>;
    const { user } = await assertCanEnroll(req);
    await reserveOrLock(user);
    if (!(await mfaState.consumeEmailCode(`enroll:${stepUpScope(req)}`, code.trim()))) {
      throw new BadRequestError("Codigo incorrecto o vencido");
    }
    await mfaState.releaseUserAttempt(user.id);
    await finishEnrollment(req, res, "email", await mfaStore.enableEmail(user.id));
  } catch (err) {
    next(err);
  }
}

function assertWebauthnEnabled(): void {
  if (!isWebauthnEnabled()) throw new NotFoundError("Las passkeys no estan habilitadas en este ambiente");
}

// POST /auth/mfa/enroll/webauthn/options
export async function enrollWebauthnOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertWebauthnEnabled();
    const { user } = await assertCanEnroll(req);
    const person = await getPersonByIdOrThrow(user.personId);
    const options = await buildRegistrationOptions({
      userId: user.id,
      userName: user.username,
      displayName: `${person.firstName} ${person.lastName}`.trim(),
      existing: await mfaStore.listStoredCredentials(user.id),
    });
    await mfaState.storeWebauthnChallenge(`enroll:${stepUpScope(req)}`, options.challenge);
    sendOk(res, options, "Opciones de registro generadas");
  } catch (err) {
    next(err);
  }
}

// POST /auth/mfa/enroll/webauthn/verify
export async function enrollWebauthnVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertWebauthnEnabled();
    const { response, deviceName } = req.body as z.infer<typeof webauthnRegisterSchema>;
    const { user } = await assertCanEnroll(req);
    const challenge = await mfaState.takeWebauthnChallenge(`enroll:${stepUpScope(req)}`);
    if (!challenge) throw new BadRequestError("El registro expiro. Vuelva a intentarlo.");
    let registration;
    try {
      registration = await checkRegistration(response as unknown as RegistrationResponseJSON, challenge);
    } catch (err) {
      logger.warn({ err: (err as Error).message, userId: user.id }, "MFA: registro de passkey rechazado");
      registration = null;
    }
    if (!registration) throw new BadRequestError("No se pudo verificar la passkey");
    await finishEnrollment(req, res, "webauthn", await mfaStore.addWebauthnCredential(user.id, registration, deviceName));
  } catch (err) {
    next(err);
  }
}

// ---- Step-up -----------------------------------------------------------------------------------

// POST /auth/mfa/step-up/email/send
export async function stepUpEmailSend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { user, factors } = await mfaStore.getUserFactors(req.user!.userId);
    if (!stepUpMethods(req, factors).includes("email")) {
      throw new BadRequestError("El codigo por correo no esta activo en su cuenta");
    }
    const sentTo = await sendEmailCode(user, `stepup:${stepUpScope(req)}`, "step-up");
    sendOk(res, { sentTo }, "Codigo enviado");
  } catch (err) {
    next(err);
  }
}

// POST /auth/mfa/step-up/webauthn/options
export async function stepUpWebauthnOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertWebauthnEnabled();
    const credentials = await mfaStore.listStoredCredentials(req.user!.userId);
    if (credentials.length === 0) throw new BadRequestError("No tiene passkeys registradas");
    const options = await buildAuthenticationOptions(credentials);
    await mfaState.storeWebauthnChallenge(`stepup:${stepUpScope(req)}`, options.challenge);
    sendOk(res, options, "Opciones de passkey generadas");
  } catch (err) {
    next(err);
  }
}

// POST /auth/mfa/step-up
export async function stepUp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = req.body as FactorInput;
    const { user, factors } = await mfaStore.getUserFactors(req.user!.userId);
    if (!stepUpMethods(req, factors).includes(input.method)) {
      throw new BadRequestError("Ese metodo no esta disponible para su cuenta");
    }
    // 400 y no 401: la sesion sigue valida, y el front trata cualquier 401 como sesion caida.
    if (!(await attemptFactor(user, `stepup:${stepUpScope(req)}`, input))) {
      throw new BadRequestError("Codigo incorrecto o vencido", { reason: "mfa_invalid_code" });
    }
    await mfaState.markStepUp(user.id, stepUpScope(req));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

// ---- Baja y mantenimiento ----------------------------------------------------------------------

async function requireStepUp(req: Request): Promise<void> {
  if (!(await mfaState.hasRecentStepUp(req.user!.userId, stepUpScope(req)))) {
    throw new ForbiddenError("Confirme su identidad con un factor actual", { reason: "mfa_step_up_required" });
  }
}

// Con MFA obligatorio la cuenta nunca queda sin factores por autoservicio (para eso esta el reset
// administrativo). Si no es obligatorio y se borra el ultimo, se limpian tambien los codigos de
// recuperacion: sin factor no tienen nada que respaldar.
async function removeFactor(
  req: Request,
  method: mfaStore.MfaMethod,
  remove: (factors: mfaStore.MfaFactors) => Promise<void>,
): Promise<void> {
  const userId = req.user!.userId;
  await requireStepUp(req);
  const { factors } = await mfaStore.getUserFactors(userId);
  if (mfaStore.countFactors(factors) <= 1 && env.mfa.required) {
    throw new ConflictError("No puede quedar sin segundo factor. Agregue otro antes de quitar este.");
  }
  await remove(factors);
  logger.info({ event: "mfa_factor_removed", userId, method }, "MFA: factor quitado");
  const after = await mfaStore.getUserFactors(userId);
  if (mfaStore.countFactors(after.factors) === 0) await mfaStore.resetMfa(userId);
}

// DELETE /auth/mfa/totp
export async function removeTotp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await removeFactor(req, "totp", async (factors) => {
      if (!factors.totp) throw new NotFoundError("No tiene una app autenticadora configurada");
      await mfaStore.disableTotp(req.user!.userId);
    });
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

// DELETE /auth/mfa/email
export async function removeEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await removeFactor(req, "email", async (factors) => {
      if (!factors.email) throw new NotFoundError("El codigo por correo no esta activo");
      await mfaStore.disableEmail(req.user!.userId);
    });
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

// DELETE /auth/mfa/webauthn/:id
export async function removeWebauthn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestError("Id de passkey invalido");
    await removeFactor(req, "webauthn", () => mfaStore.deleteWebauthnCredential(req.user!.userId, id));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

// PATCH /auth/mfa/webauthn/:id: solo el nombre visible, no cambia la seguridad (sin step-up).
export async function renameWebauthn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestError("Id de passkey invalido");
    const { deviceName } = req.body as z.infer<typeof renameCredentialSchema>;
    await mfaStore.renameWebauthnCredential(req.user!.userId, id, deviceName);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

// POST /auth/mfa/recovery-codes: invalida los anteriores.
export async function regenerateRecoveryCodes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    await requireStepUp(req);
    const { factors } = await mfaStore.getUserFactors(userId);
    if (mfaStore.countFactors(factors) === 0) throw new BadRequestError("Primero configure un segundo factor");
    const recoveryCodes = await mfaStore.replaceRecoveryCodes(userId);
    logger.info({ event: "mfa_recovery_codes_regenerated", userId }, "MFA: codigos de recuperacion regenerados");
    sendOk(res, { recoveryCodes }, "Codigos de recuperacion generados");
  } catch (err) {
    next(err);
  }
}
