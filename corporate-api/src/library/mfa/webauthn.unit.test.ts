import { beforeEach, describe, expect, it, vi } from "vitest";

// env real exige las 4 bases de datos; aca solo importa la config de WebAuthn. La libreria se mockea:
// lo que se prueba es que el envoltorio le pase rpID/origenes/contador correctos y trate cualquier
// rechazo como "no verificado", no la criptografia de @simplewebauthn/server.
const webauthnEnv = vi.hoisted(() => ({
  rpId: "erp.empresa.cl",
  rpName: "Corporate",
  origins: ["https://erp.empresa.cl"],
}));
vi.mock("../env", () => ({ env: { webauthn: webauthnEnv } }));

const lib = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock("@simplewebauthn/server", () => lib);

import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  checkAuthentication,
  checkRegistration,
  isWebauthnEnabled,
  type StoredCredential,
} from "./webauthn";

const credential: StoredCredential = {
  credentialId: "cred-1",
  publicKey: Buffer.from([1, 2, 3]),
  signCount: 7,
  transports: ["internal", "hybrid"],
};

beforeEach(() => {
  vi.clearAllMocks();
  webauthnEnv.rpId = "erp.empresa.cl";
  webauthnEnv.origins = ["https://erp.empresa.cl"];
});

describe("webauthn", () => {
  it("solo se habilita con RP ID y al menos un origen", () => {
    expect(isWebauthnEnabled()).toBe(true);
    webauthnEnv.rpId = "";
    expect(isWebauthnEnabled()).toBe(false);
    webauthnEnv.rpId = "erp.empresa.cl";
    webauthnEnv.origins = [];
    expect(isWebauthnEnabled()).toBe(false);
  });

  it("el registro excluye las passkeys ya registradas y usa un handle opaco", async () => {
    lib.generateRegistrationOptions.mockResolvedValue({ challenge: "c" });
    await buildRegistrationOptions({ userId: 42, userName: "jperez", displayName: "Juan Perez", existing: [credential] });
    const options = lib.generateRegistrationOptions.mock.calls[0]![0];
    expect(options.rpID).toBe("erp.empresa.cl");
    expect(options.excludeCredentials).toEqual([{ id: "cred-1", transports: ["internal", "hybrid"] }]);
    expect(new TextDecoder().decode(options.userID)).toBe("corp-user-42");
    expect(options.attestationType).toBe("none");
  });

  it("verifica el registro contra los origenes y el RP ID configurados", async () => {
    lib.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: "nueva", publicKey: new Uint8Array([9]), counter: 0, transports: ["usb"] },
        aaguid: "00000000-0000-0000-0000-000000000000",
        credentialBackedUp: false,
      },
    });
    const result = await checkRegistration({} as never, "challenge-x");
    const options = lib.verifyRegistrationResponse.mock.calls[0]![0];
    expect(options.expectedChallenge).toBe("challenge-x");
    expect(options.expectedOrigin).toEqual(["https://erp.empresa.cl"]);
    expect(options.expectedRPID).toBe("erp.empresa.cl");
    expect(result).toMatchObject({ credentialId: "nueva", signCount: 0, transports: ["usb"] });
    expect(result!.publicKey.equals(Buffer.from([9]))).toBe(true);
  });

  it("un registro no verificado devuelve null", async () => {
    lib.verifyRegistrationResponse.mockResolvedValue({ verified: false });
    expect(await checkRegistration({} as never, "c")).toBeNull();
  });

  it("la autenticacion se limita a las passkeys de la cuenta", async () => {
    lib.generateAuthenticationOptions.mockResolvedValue({ challenge: "c" });
    await buildAuthenticationOptions([credential]);
    expect(lib.generateAuthenticationOptions.mock.calls[0]![0].allowCredentials).toEqual([
      { id: "cred-1", transports: ["internal", "hybrid"] },
    ]);
  });

  it("pasa el contador guardado (la libreria rechaza uno que no avanza) y devuelve el nuevo", async () => {
    lib.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 8, credentialBackedUp: true },
    });
    const result = await checkAuthentication({} as never, "c", credential);
    const options = lib.verifyAuthenticationResponse.mock.calls[0]![0];
    expect(options.credential.counter).toBe(7);
    expect(options.credential.id).toBe("cred-1");
    expect(result).toEqual({ newSignCount: 8, backedUp: true });
  });

  it("una autenticacion no verificada devuelve null y un rechazo de la libreria se propaga", async () => {
    lib.verifyAuthenticationResponse.mockResolvedValue({ verified: false, authenticationInfo: {} });
    expect(await checkAuthentication({} as never, "c", credential)).toBeNull();
    lib.verifyAuthenticationResponse.mockRejectedValue(new Error("Response counter value 3 was lower than expected 7"));
    await expect(checkAuthentication({} as never, "c", credential)).rejects.toThrow("counter");
  });
});
