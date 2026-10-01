import { mssql } from "../../databases/mssql/connection";
import { UserModel } from "../../models/mssql/user.model";
import { WebauthnCredentialModel } from "../../models/mssql/webauthnCredential.model";
import { MfaRecoveryCodeModel } from "../../models/mssql/mfaRecoveryCode.model";
import { ConflictError, NotFoundError } from "../../library/errors";
import { hashCode } from "../../library/mfa/keys";
import { generateRecoveryCodes, normalizeRecoveryCode } from "../../library/mfa/recoveryCodes";
import { isWebauthnEnabled, type StoredCredential, type VerifiedRegistration } from "../../library/mfa/webauthn";

// Plan 017: los factores persistidos de cada usuario. Las reglas de flujo (cuando se exige cada uno,
// step-up, sesion pre-auth) viven en controllers/mfa.controller.ts; aca solo la persistencia y los
// invariantes de datos.

export type MfaMethod = "webauthn" | "totp" | "email" | "recovery";

export interface WebauthnCredentialSummary {
  id: number;
  deviceName: string;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface MfaFactors {
  totp: boolean;
  email: boolean;
  webauthn: WebauthnCredentialSummary[];
  recoveryCodesRemaining: number;
  enrolledAt: Date | null;
}

function toStoredCredential(row: WebauthnCredentialModel): StoredCredential {
  return {
    credentialId: row.credentialId,
    publicKey: Buffer.from(row.publicKey),
    signCount: row.signCount,
    transports: row.transports ? row.transports.split(",") : [],
  };
}

export async function listStoredCredentials(userId: number): Promise<StoredCredential[]> {
  const rows = await WebauthnCredentialModel.findAll({ where: { userId } });
  return rows.map(toStoredCredential);
}

export async function getMfaFactors(user: UserModel): Promise<MfaFactors> {
  const [credentials, recoveryCodesRemaining] = await Promise.all([
    WebauthnCredentialModel.findAll({ where: { userId: user.id }, order: [["createdAt", "ASC"]] }),
    MfaRecoveryCodeModel.count({ where: { userId: user.id, usedAt: null } }),
  ]);
  return {
    totp: user.mfaTotpSecretEnc != null,
    email: user.mfaEmailEnabled,
    webauthn: credentials.map((row) => ({
      id: row.id,
      deviceName: row.deviceName,
      backedUp: row.backedUp,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    })),
    recoveryCodesRemaining,
    enrolledAt: user.mfaEnrolledAt,
  };
}

// Cantidad de factores "reales" (los codigos de recuperacion no cuentan: son el respaldo de estos).
// Las passkeys cuentan aunque el metodo este deshabilitado por config, porque siguen registradas.
export function countFactors(factors: MfaFactors): number {
  return (factors.totp ? 1 : 0) + (factors.email ? 1 : 0) + factors.webauthn.length;
}

// Metodos que el usuario puede usar AHORA para el segundo factor, en orden de preferencia.
export function availableMethods(factors: MfaFactors): MfaMethod[] {
  const methods: MfaMethod[] = [];
  if (factors.webauthn.length > 0 && isWebauthnEnabled()) methods.push("webauthn");
  if (factors.totp) methods.push("totp");
  if (factors.email) methods.push("email");
  if (factors.recoveryCodesRemaining > 0) methods.push("recovery");
  return methods;
}

export async function getUserFactors(userId: number): Promise<{ user: UserModel; factors: MfaFactors }> {
  const user = await UserModel.findByPk(userId);
  if (!user) throw new NotFoundError(`El usuario ${userId} no existe`);
  return { user, factors: await getMfaFactors(user) };
}

// ---- Alta de factores --------------------------------------------------------------------------
// Cada alta devuelve los codigos de recuperacion SOLO si era el primer factor de la cuenta (el
// unico momento en que se generan solos); despues se regeneran a pedido.

async function afterFactorAdded(userId: number, hadFactors: boolean): Promise<string[] | null> {
  if (hadFactors) return null;
  await UserModel.update({ mfaEnrolledAt: new Date() }, { where: { id: userId } });
  return replaceRecoveryCodes(userId);
}

export async function enableTotp(userId: number, encryptedSecret: string): Promise<string[] | null> {
  const { user, factors } = await getUserFactors(userId);
  if (factors.totp) throw new ConflictError("Ya tiene una app autenticadora configurada");
  await user.update({ mfaTotpSecretEnc: encryptedSecret });
  return afterFactorAdded(userId, countFactors(factors) > 0);
}

export async function enableEmail(userId: number): Promise<string[] | null> {
  const { user, factors } = await getUserFactors(userId);
  if (factors.email) throw new ConflictError("El codigo por correo ya esta activo");
  await user.update({ mfaEmailEnabled: true });
  return afterFactorAdded(userId, countFactors(factors) > 0);
}

export async function addWebauthnCredential(
  userId: number,
  registration: VerifiedRegistration,
  deviceName: string,
): Promise<string[] | null> {
  const { factors } = await getUserFactors(userId);
  const existing = await WebauthnCredentialModel.findOne({ where: { credentialId: registration.credentialId } });
  if (existing) throw new ConflictError("Esta passkey ya esta registrada");
  await WebauthnCredentialModel.create({
    userId,
    credentialId: registration.credentialId,
    publicKey: registration.publicKey,
    signCount: registration.signCount,
    transports: registration.transports.length > 0 ? registration.transports.join(",") : null,
    deviceName,
    aaguid: registration.aaguid,
    backedUp: registration.backedUp,
    lastUsedAt: null,
  });
  return afterFactorAdded(userId, countFactors(factors) > 0);
}

// ---- Uso de factores ---------------------------------------------------------------------------

export async function findCredentialForUser(userId: number, credentialId: string): Promise<StoredCredential | null> {
  const row = await WebauthnCredentialModel.findOne({ where: { userId, credentialId } });
  return row ? toStoredCredential(row) : null;
}

export async function recordCredentialUse(credentialId: string, newSignCount: number, backedUp: boolean): Promise<void> {
  await WebauthnCredentialModel.update(
    { signCount: newSignCount, backedUp, lastUsedAt: new Date() },
    { where: { credentialId } },
  );
}

// UPDATE condicionado a used_at IS NULL: dos requests con el mismo codigo, solo una lo marca.
export async function consumeRecoveryCode(userId: number, input: string): Promise<boolean> {
  const codeHash = hashCode(normalizeRecoveryCode(input));
  const [affected] = await MfaRecoveryCodeModel.update(
    { usedAt: new Date() },
    { where: { userId, codeHash, usedAt: null } },
  );
  return affected === 1;
}

export async function replaceRecoveryCodes(userId: number): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await mssql.transaction(async (transaction) => {
    await MfaRecoveryCodeModel.destroy({ where: { userId }, transaction });
    await MfaRecoveryCodeModel.bulkCreate(
      codes.map((code) => ({ userId, codeHash: hashCode(code), usedAt: null })),
      { transaction },
    );
  });
  return codes;
}

// ---- Baja de factores --------------------------------------------------------------------------

export async function disableTotp(userId: number): Promise<void> {
  await UserModel.update({ mfaTotpSecretEnc: null }, { where: { id: userId } });
}

export async function disableEmail(userId: number): Promise<void> {
  await UserModel.update({ mfaEmailEnabled: false }, { where: { id: userId } });
}

export async function deleteWebauthnCredential(userId: number, id: number): Promise<void> {
  const deleted = await WebauthnCredentialModel.destroy({ where: { id, userId } });
  if (deleted === 0) throw new NotFoundError("La passkey no existe");
}

export async function renameWebauthnCredential(userId: number, id: number, deviceName: string): Promise<void> {
  const [affected] = await WebauthnCredentialModel.update({ deviceName }, { where: { id, userId } });
  if (affected === 0) throw new NotFoundError("La passkey no existe");
}

// Reset administrativo (telefono o notebook perdido): la cuenta queda sin factores y, si MFA es
// obligatorio, tendra que enrolar uno nuevo en su proximo ingreso.
export async function resetMfa(userId: number): Promise<void> {
  await mssql.transaction(async (transaction) => {
    await WebauthnCredentialModel.destroy({ where: { userId }, transaction });
    await MfaRecoveryCodeModel.destroy({ where: { userId }, transaction });
    await UserModel.update(
      { mfaTotpSecretEnc: null, mfaEmailEnabled: false, mfaEnrolledAt: null },
      { where: { id: userId }, transaction },
    );
  });
}
