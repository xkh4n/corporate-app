import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secretBox";
import { generateRecoveryCodes, normalizeRecoveryCode } from "./recoveryCodes";
import { generateEmailCode, maskEmail } from "./emailCode";

describe("secretBox", () => {
  const key = randomBytes(32);

  it("cifra y descifra; dos cifrados del mismo valor difieren (IV aleatorio)", () => {
    const a = encryptSecret("JBSWY3DPEHPK3PXP", key, "user:1");
    const b = encryptSecret("JBSWY3DPEHPK3PXP", key, "user:1");
    expect(a).not.toBe(b);
    expect(a.startsWith("v2.")).toBe(true);
    expect(decryptSecret(a, key, "user:1")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("rechaza un cifrado alterado, con otra clave o copiado a otra cuenta (GCM autentica el AAD)", () => {
    const payload = encryptSecret("JBSWY3DPEHPK3PXP", key, "user:1");
    const parts = payload.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("otra-cosa").toString("base64url")].join(".");
    expect(() => decryptSecret(tampered, key, "user:1")).toThrow();
    expect(() => decryptSecret(payload, randomBytes(32), "user:1")).toThrow();
    expect(() => decryptSecret(payload, key, "user:2")).toThrow();
    expect(() => decryptSecret("v9.a.b.c", key, "user:1")).toThrow("formato desconocido");
  });

  it("el formato v1 (sin AAD) solo se acepta con allowV1 (development)", async () => {
    const { createCipheriv } = await import("node:crypto");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update("LEGACY", "utf8"), cipher.final()]);
    const v1 = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
    expect(() => decryptSecret(v1, key, "user:1")).toThrow("formato desconocido");
    expect(decryptSecret(v1, key, "user:1", { allowV1: true })).toBe("LEGACY");
  });
});

describe("codigos de recuperacion", () => {
  it("genera 10 codigos unicos con el formato xxxxx-xxxxx y sin caracteres ambiguos", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
  });

  it("normaliza mayusculas, espacios y guion faltante", () => {
    expect(normalizeRecoveryCode(" ABCDE fghjk ")).toBe("abcde-fghjk");
    expect(normalizeRecoveryCode("abcdefghjk")).toBe("abcde-fghjk");
    expect(normalizeRecoveryCode("abc")).toBe("abc");
  });
});

describe("maskEmail", () => {
  it("deja ver solo el primer y ultimo caracter del usuario", () => {
    expect(maskEmail("osvaldo@empresa.cl")).toBe("o*****o@empresa.cl");
    expect(maskEmail("ab@x.cl")).toBe("a*@x.cl");
    expect(maskEmail("unnombremuylargo@x.cl")).toBe("u******o@x.cl");
  });

  it("los codigos por correo son siempre de 6 digitos", () => {
    for (let i = 0; i < 50; i++) expect(generateEmailCode()).toMatch(/^\d{6}$/);
  });
});
