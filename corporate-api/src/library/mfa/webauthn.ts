import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { env } from "../env";

// Envoltorio fino sobre @simplewebauthn/server: fija rpID/origenes desde env y deja al resto del
// codigo trabajar con tipos propios (Buffer para la BD). El challenge lo genera la libreria y el
// caller lo guarda en Redis (un solo uso, ver services/redis/mfa.service.ts).
//
// Las passkeys son SEGUNDO factor (la password ya se valido): userVerification "preferred" y sin
// exigirla, asi tambien sirven llaves FIDO2 sin PIN.

export function isWebauthnEnabled(): boolean {
  return env.webauthn.rpId.length > 0 && env.webauthn.origins.length > 0;
}

export interface StoredCredential {
  credentialId: string;
  publicKey: Buffer;
  signCount: number;
  transports: string[];
}

function parseTransports(transports: string[] | undefined): AuthenticatorTransportList {
  return (transports ?? []) as AuthenticatorTransportList;
}
type AuthenticatorTransportList = ("ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb")[];

export async function buildRegistrationOptions(params: {
  userId: number;
  userName: string;
  displayName: string;
  existing: StoredCredential[];
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: env.webauthn.rpName,
    rpID: env.webauthn.rpId,
    userName: params.userName,
    userDisplayName: params.displayName,
    // Handle opaco y estable (no el RUT ni el correo): el autenticador lo guarda junto a la passkey.
    userID: new TextEncoder().encode(`corp-user-${params.userId}`),
    attestationType: "none",
    // El mismo autenticador no se registra dos veces para la misma cuenta.
    excludeCredentials: params.existing.map((credential) => ({
      id: credential.credentialId,
      transports: parseTransports(credential.transports),
    })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
}

export interface VerifiedRegistration {
  credentialId: string;
  publicKey: Buffer;
  signCount: number;
  transports: string[];
  aaguid: string;
  backedUp: boolean;
}

export async function checkRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<VerifiedRegistration | null> {
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: [...env.webauthn.origins],
    expectedRPID: env.webauthn.rpId,
    requireUserVerification: false,
  });
  if (!result.verified) return null;
  const { credential, aaguid, credentialBackedUp } = result.registrationInfo;
  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey),
    signCount: credential.counter,
    transports: credential.transports ?? [],
    aaguid,
    backedUp: credentialBackedUp,
  };
}

export async function buildAuthenticationOptions(
  credentials: StoredCredential[],
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: env.webauthn.rpId,
    // Solo las passkeys de ESTA cuenta: la password ya identifico al usuario.
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: parseTransports(credential.transports),
    })),
    userVerification: "preferred",
  });
}

// La libreria rechaza (lanza) si el contador no avanza cuando el autenticador lo usa: es la señal
// de una passkey clonada. Cualquier error se trata como verificacion fallida.
export async function checkAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  credential: StoredCredential,
): Promise<{ newSignCount: number; backedUp: boolean } | null> {
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: [...env.webauthn.origins],
    expectedRPID: env.webauthn.rpId,
    credential: {
      id: credential.credentialId,
      publicKey: new Uint8Array(credential.publicKey),
      counter: credential.signCount,
      transports: parseTransports(credential.transports),
    },
    requireUserVerification: false,
  });
  if (!result.verified) return null;
  return { newSignCount: result.authenticationInfo.newCounter, backedUp: result.authenticationInfo.credentialBackedUp };
}
